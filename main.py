import asyncio
import importlib
import io
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
import zipfile
from collections import Counter
from pathlib import Path

import pymupdf
import pytesseract
from PIL import Image
from fastapi import FastAPI, File, Form, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
GENERATED_DIR = BASE_DIR / "generated"
TEMP_DIR = BASE_DIR / "temp"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

for directory in (UPLOAD_DIR, GENERATED_DIR, TEMP_DIR, TEMPLATES_DIR, STATIC_DIR):
    directory.mkdir(parents=True, exist_ok=True)

PDF_DPI = 800
OCR_DPI = 240
OCR_LANGUAGE = "eng"
MAX_FILE_SIZE = 100 * 1024 * 1024
VALID_JOB_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{32}$")
WEBP_QUALITY = 99

app = FastAPI(
    title="PDF Flipbook Agent",
    description="Convert PDF documents into high-resolution interactive web flipbooks.",
    version="1.0.0",
)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")
app.mount("/generated", StaticFiles(directory=str(GENERATED_DIR)), name="generated")
templates = Jinja2Templates(directory=str(TEMPLATES_DIR))


@app.on_event("startup")
async def startup_event():
    cleanup_stale_generated_assets()


def get_job_directory(job_id: str) -> Path:
    return GENERATED_DIR / job_id


DEFAULT_FLIPBOOK_SETTINGS = {
    "theme": "classic",
    "mode": "light",
    "backgroundColor": "#f3f3f3",
    "viewerBackground": "#f8f8f8",
    "toolbarColor": "#ffffff",
    "accentColor": "#2d3748",
    "title": "",
    "subtitle": "",
    "companyName": "",
    "showLogo": False,
    "logo": "",
    "backgroundImage": "",
    "showSearch": True,
    "showThumbnails": True,
    "showZoom": True,
    "showFullscreen": True,
    "showShare": True,
    "showDownload": True,
    "pageShadow": True,
    "pageTurnSound": False,
    "toolbarPosition": "top",
}

ALLOWED_IMAGE_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp"}
MAX_BRAND_IMAGE_SIZE = 5 * 1024 * 1024


def sanitize_custom_text(value, max_length: int = 180) -> str:
    if value is None:
        return ""
    text = str(value).replace("\x00", "").strip()
    if len(text) > max_length:
        text = text[:max_length]
    return text


def safe_asset_name(filename: str | None) -> str:
    if not filename:
        raise ValueError("No file name was provided.")
    sanitized_name = Path(filename).name
    if not sanitized_name or sanitized_name in {".", ".."}:
        raise ValueError("The uploaded file name is invalid.")
    if sanitized_name.startswith("/") or sanitized_name.startswith("\\"):
        raise ValueError("Invalid uploaded file path.")
    safe_name = re.sub(r"[^A-Za-z0-9._-]+", "-", sanitized_name)
    if not safe_name or safe_name in {".", ".."}:
        raise ValueError("The uploaded file name is invalid.")
    return safe_name


def normalize_hex_color(value, fallback: str):
    if not isinstance(value, str):
        return fallback
    cleaned = value.strip()
    if not cleaned:
        return fallback
    if cleaned.startswith("#"):
        cleaned = cleaned[1:]
    if len(cleaned) != 6 or not re.fullmatch(r"[0-9a-fA-F]{6}", cleaned):
        return fallback
    return f"#{cleaned.lower()}"


def normalize_bool(value, fallback: bool):
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        lowered = value.strip().lower()
        if lowered in {"true", "1", "yes", "on"}:
            return True
        if lowered in {"false", "0", "no", "off"}:
            return False
    return fallback


def normalize_job_settings(raw_settings: dict | None, default_title: str = "") -> dict:
    raw_settings = raw_settings if isinstance(raw_settings, dict) else {}
    settings = dict(DEFAULT_FLIPBOOK_SETTINGS)
    if default_title:
        settings["title"] = default_title
    settings.update({
        "theme": raw_settings.get("theme", settings["theme"]) if raw_settings.get("theme") in {"classic", "minimal", "magazine", "dark"} else settings["theme"],
        "mode": raw_settings.get("mode", settings["mode"]) if raw_settings.get("mode") in {"light", "dark"} else settings["mode"],
        "backgroundColor": normalize_hex_color(raw_settings.get("backgroundColor"), settings["backgroundColor"]),
        "viewerBackground": normalize_hex_color(raw_settings.get("viewerBackground"), settings["viewerBackground"]),
        "toolbarColor": normalize_hex_color(raw_settings.get("toolbarColor"), settings["toolbarColor"]),
        "accentColor": normalize_hex_color(raw_settings.get("accentColor"), settings["accentColor"]),
        "title": sanitize_custom_text(raw_settings.get("title") or default_title or settings["title"], 120),
        "subtitle": sanitize_custom_text(raw_settings.get("subtitle"), 120),
        "companyName": sanitize_custom_text(raw_settings.get("companyName"), 120),
        "showLogo": normalize_bool(raw_settings.get("showLogo"), settings["showLogo"]),
        "logo": sanitize_custom_text(raw_settings.get("logo"), 200),
        "backgroundImage": sanitize_custom_text(raw_settings.get("backgroundImage"), 240),
        "showSearch": normalize_bool(raw_settings.get("showSearch"), settings["showSearch"]),
        "showThumbnails": normalize_bool(raw_settings.get("showThumbnails"), settings["showThumbnails"]),
        "showZoom": normalize_bool(raw_settings.get("showZoom"), settings["showZoom"]),
        "showFullscreen": normalize_bool(raw_settings.get("showFullscreen"), settings["showFullscreen"]),
        "showShare": normalize_bool(raw_settings.get("showShare"), settings["showShare"]),
        "showDownload": normalize_bool(raw_settings.get("showDownload"), settings["showDownload"]),
        "pageShadow": normalize_bool(raw_settings.get("pageShadow"), settings["pageShadow"]),
        "pageTurnSound": normalize_bool(raw_settings.get("pageTurnSound"), settings["pageTurnSound"]),
        "toolbarPosition": raw_settings.get("toolbarPosition", settings["toolbarPosition"]) if raw_settings.get("toolbarPosition") in {"top", "bottom"} else settings["toolbarPosition"],
    })
    return settings


def write_job_settings(job_directory: Path, settings: dict):
    settings_path = job_directory / "settings.json"
    serialized = json.dumps(settings, ensure_ascii=False, indent=2)
    settings_path.write_text(serialized, encoding="utf-8")


def load_job_settings(job_id: str, default_title: str = "") -> dict:
    settings_path = get_job_directory(job_id) / "settings.json"
    defaults = normalize_job_settings({}, default_title)
    if not settings_path.exists():
        return defaults
    try:
        payload = json.loads(settings_path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return defaults
    return normalize_job_settings(payload, default_title or defaults["title"])


async def save_uploaded_asset(file: UploadFile | None, destination: Path, max_size: int = MAX_BRAND_IMAGE_SIZE):
    if file is None:
        return None
    if file.filename is None:
        raise ValueError("The uploaded file is missing a valid name.")
    file_name = safe_asset_name(file.filename)
    file_suffix = Path(file_name).suffix.lower()
    if file_suffix not in ALLOWED_IMAGE_SUFFIXES:
        raise ValueError("Only PNG, JPG, JPEG, and WEBP files are allowed for branding assets.")
    destination = destination.with_name(file_name)
    total_size = 0
    try:
        with open(destination, "wb") as output_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > max_size:
                    raise ValueError("The uploaded image exceeds the maximum allowed size of 5 MB.")
                output_file.write(chunk)
        return destination
    finally:
        await file.close()


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


def validate_job_id(job_id: str | None):
    return bool(job_id and VALID_JOB_ID_PATTERN.fullmatch(job_id))


def validate_pdf(pdf_path: Path):
    document = None
    try:
        document = pymupdf.open(str(pdf_path))
        if document.page_count <= 0:
            return False, "The PDF contains no pages."
        return True, None
    except Exception as error:
        return False, f"Invalid PDF: {error}"
    finally:
        if document is not None:
            document.close()


def get_pdf_information(pdf_path: Path):
    document = None
    try:
        document = pymupdf.open(str(pdf_path))
        metadata = document.metadata or {}
        page_dimensions = []
        for page_number in range(document.page_count):
            rect = document.load_page(page_number).rect
            width = float(rect.width)
            height = float(rect.height)
            page_dimensions.append({
                "page": page_number + 1,
                "width": width,
                "height": height,
                "aspect_ratio": width / height,
            })

        ratio_counts = Counter(round(page["aspect_ratio"], 6) for page in page_dimensions)
        common_ratio = ratio_counts.most_common(1)[0][0]
        common_page = next(
            page for page in page_dimensions
            if round(page["aspect_ratio"], 6) == common_ratio
        )
        return {
            "page_count": document.page_count,
            "title": metadata.get("title") or "",
            "author": metadata.get("author") or "",
            "subject": metadata.get("subject") or "",
            "keywords": metadata.get("keywords") or "",
            "page_width": common_page["width"],
            "page_height": common_page["height"],
            "aspect_ratio": common_page["aspect_ratio"],
            "page_dimensions": page_dimensions,
        }
    finally:
        if document is not None:
            document.close()


def normalize_job_metadata(metadata):
    if isinstance(metadata, dict):
        return metadata
    if not isinstance(metadata, list):
        return {}
    dimensions = [
        {
            "page": page.get("page"),
            "width": page.get("pdf_width"),
            "height": page.get("pdf_height"),
            "aspect_ratio": page.get("aspect_ratio"),
        }
        for page in metadata
    ]
    first = dimensions[0] if dimensions else {}
    return {
        "page_width": first.get("width"),
        "page_height": first.get("height"),
        "aspect_ratio": first.get("aspect_ratio"),
        "page_dimensions": dimensions,
    }


def render_page_to_webp(page, output_file: Path):
    zoom = PDF_DPI / 72.0
    pixmap = page.get_pixmap(matrix=pymupdf.Matrix(zoom, zoom), alpha=False)
    try:
        pixmap.pil_save(
            str(output_file),
            format="WEBP",
            quality=WEBP_QUALITY,
            method=6,
            lossless=True,
        )
    finally:
        pixmap = None


def render_pdf_pages(pdf_path: Path, output_directory: Path):
    output_directory.mkdir(parents=True, exist_ok=True)
    document = None
    generated_pages = []
    try:
        document = pymupdf.open(str(pdf_path))
        for page_number in range(document.page_count):
            page = document.load_page(page_number)
            filename = f"page-{page_number + 1:04d}.webp"
            render_page_to_webp(page, output_directory / filename)
            generated_pages.append(f"/generated/{output_directory.name}/{filename}")
        return generated_pages
    finally:
        if document is not None:
            document.close()


def configure_tesseract():
    configured_path = os.environ.get("TESSERACT_CMD") or shutil.which("tesseract")
    if configured_path:
            pytesseract.pytesseract.tesseract_cmd = configured_path
    elif os.name == "nt":
            common_path = Path(os.environ.get("ProgramFiles", r"C:\Program Files")) / "Tesseract-OCR" / "tesseract.exe"
            if common_path.is_file():
                pytesseract.pytesseract.tesseract_cmd = str(common_path)


def get_ocr_engine_error():
    configure_tesseract()
    try:
            pytesseract.get_tesseract_version()
    except pytesseract.TesseractNotFoundError:
            return (
                "Tesseract OCR is not installed or could not be found. "
                "Install Tesseract OCR or set the TESSERACT_CMD environment variable."
            )
    try:
        installed_languages = pytesseract.get_languages(config="")
    except pytesseract.TesseractError as error:
        return f"Tesseract could not load language data: {error}"
    if OCR_LANGUAGE not in installed_languages:
            return (
                f"Tesseract language data '{OCR_LANGUAGE}' is not installed. "
                "Install the required language data and regenerate the flipbook."
            )
    return None


def recognize_image_text(image):
    return pytesseract.image_to_string(image, lang=OCR_LANGUAGE, config="--psm 3").strip()


def recognize_pdf_page_text(page):
    pixmap = page.get_pixmap(dpi=OCR_DPI, colorspace=pymupdf.csRGB, alpha=False)
    try:
            with Image.open(io.BytesIO(pixmap.tobytes("png"))) as image:
                image.load()
                return recognize_image_text(image)
    finally:
            pixmap = None


def save_search_index(search_index: dict, output_directory: Path) -> bool:
    try:
            output_directory.mkdir(parents=True, exist_ok=True)
            (output_directory / "search-index.json").write_text(
                json.dumps(search_index, ensure_ascii=False),
                encoding="utf-8",
            )
    except OSError as error:
            print(f"Warning: Could not save PDF text search index: {error}")
            return False
    return search_index["has_text"]


def create_search_index(pdf_path: Path, output_directory: Path):
    search_index = {"has_text": False, "pages": [], "ocr_pages": 0}
    document = None
    ocr_engine_error = None
    ocr_page_errors = set()
    try:
            document = pymupdf.open(str(pdf_path))
            ocr_engine_error = get_ocr_engine_error()
            for page_number in range(document.page_count):
                page = document.load_page(page_number)
                text = ""
                try:
                    text = page.get_text("text") or ""
                    if not text.strip() and not ocr_engine_error:
                        text = recognize_pdf_page_text(page)
                        if text.strip():
                            search_index["ocr_pages"] += 1
                except Exception as error:
                    print(f"Warning: Could not extract text from page {page_number + 1}: {error}")
                    if not text.strip():
                        ocr_page_errors.add(str(error))
                search_index["pages"].append({"page": page_number + 1, "text": text})
                search_index["has_text"] = search_index["has_text"] or bool(text.strip())
            if ocr_engine_error:
                search_index["ocr_error"] = ocr_engine_error
            elif ocr_page_errors:
                search_index["ocr_error"] = "OCR failed: " + "; ".join(sorted(ocr_page_errors))
    except Exception as error:
            print(f"Warning: Could not create PDF text search index: {error}")
    finally:
            if document is not None:
                document.close()

    return save_search_index(search_index, output_directory)


def create_search_index_from_page_images(page_files: list[Path], output_directory: Path):
    search_index = {"has_text": False, "pages": [], "ocr_pages": 0}
    ocr_engine_error = get_ocr_engine_error()
    ocr_page_errors = set()
    for page_number, page_file in enumerate(page_files, start=1):
            text = ""
            if not ocr_engine_error:
                try:
                    with Image.open(page_file) as image:
                        image.thumbnail((2400, 3200))
                        text = recognize_image_text(image)
                    if text:
                        search_index["ocr_pages"] += 1
                except Exception as error:
                    print(f"Warning: Could not OCR generated page {page_number}: {error}")
                    ocr_page_errors.add(str(error))
            search_index["pages"].append({"page": page_number, "text": text})
            search_index["has_text"] = search_index["has_text"] or bool(text.strip())
    if ocr_engine_error:
            search_index["ocr_error"] = ocr_engine_error
    elif ocr_page_errors:
            search_index["ocr_error"] = "OCR failed: " + "; ".join(sorted(ocr_page_errors))
    return save_search_index(search_index, output_directory)


async def save_uploaded_pdf(file: UploadFile, destination: Path):
    total_size = 0
    try:
        with open(destination, "wb") as output_file:
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total_size += len(chunk)
                if total_size > MAX_FILE_SIZE:
                    raise ValueError("PDF is larger than the maximum allowed size of 100 MB.")
                output_file.write(chunk)
        return total_size
    finally:
        await file.close()


def safe_delete_file(file_path: Path | None):
    if file_path is None:
        return
    try:
        if file_path.exists():
            file_path.unlink()
    except Exception as error:
        print(f"Warning: Could not delete {file_path}: {error}")


def safe_delete_directory(directory: Path | None):
    if directory is None:
        return
    try:
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
    except Exception as error:
        print(f"Warning: Could not remove {directory}: {error}")


def cleanup_stale_generated_assets(max_age_hours: int = 24):
    cutoff = time.time() - max_age_hours * 60 * 60
    for child in GENERATED_DIR.iterdir():
        if child.is_dir():
            try:
                if child.stat().st_mtime < cutoff:
                    safe_delete_directory(child)
            except OSError:
                continue


def create_flipbook_video(job_id: str, page_files: list[Path], aspect_ratio: float):
    try:
        sync_playwright = importlib.import_module("playwright.sync_api").sync_playwright
    except ImportError as error:
        raise RuntimeError(
            "Playwright is not installed. Run 'pip install playwright' and 'playwright install chromium'."
        ) from error
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("FFmpeg is not installed or is not on PATH. Install FFmpeg and retry.")

    video_file = GENERATED_DIR / job_id / "flipbook-video.mp4"
    with tempfile.TemporaryDirectory(prefix="flipbook-video-") as temporary_directory:
        temporary_directory = Path(temporary_directory)
        video_pages = temporary_directory / "pages"
        video_pages.mkdir()
        for page_file in page_files:
            shutil.copy2(page_file, video_pages / page_file.name)

        sources = json.dumps([f"pages/{page.name}" for page in page_files])
        video_html = f"""<!doctype html><html><head><meta charset=\"utf-8\"><style>
html,body{{margin:0;width:100%;height:100%;background:#111;overflow:hidden}}
body{{display:grid;place-items:center}}.book{{position:relative;width:min(92vw,1200px);aspect-ratio:{aspect_ratio};perspective:1800px}}
.page{{position:absolute;inset:0;background:white;backface-visibility:hidden;transform-origin:left center}}
.page img{{display:block;width:100%;height:100%;object-fit:contain}}.cover{{z-index:3;background:linear-gradient(135deg,#0c3973,#145ca5 48%,#082d60);box-shadow:0 14px 28px #0009}}
.cover img{{mix-blend-mode:screen;opacity:.32}}.open{{animation:open-cover 1s cubic-bezier(.22,.72,.18,1) forwards}}.turn{{animation:turn-page 1s cubic-bezier(.22,.72,.18,1) forwards;z-index:4}}
@keyframes open-cover{{from{{transform:rotateY(0deg)}}to{{transform:rotateY(-168deg)}}}}@keyframes turn-page{{from{{transform:rotateY(0deg)}}to{{transform:rotateY(-168deg)}}}}
</style></head><body><div class=\"book\" id=\"book\"></div><script>
const sources={sources},book=document.getElementById('book');const wait=m=>new Promise(r=>setTimeout(r,m));
const image=s=>{{const i=document.createElement('img');i.src=s;return i}};
async function run(){{await Promise.all(sources.map(s=>new Promise(r=>{{const i=new Image();i.onload=r;i.onerror=r;i.src=s}})));
const cover=document.createElement('div');cover.className='page cover';cover.appendChild(image(sources[0]));book.appendChild(cover);await wait(2200);cover.classList.add('open');await wait(1200);cover.remove();
for(let n=0;n<sources.length;n++){{const current=document.createElement('div');current.className='page';current.appendChild(image(sources[n]));book.appendChild(current);await wait(1800);if(n<sources.length-1){{current.classList.add('turn');await wait(1200);current.remove()}}}}
const back=document.createElement('div');back.className='page cover';back.appendChild(image(sources[sources.length-1]));book.appendChild(back);await wait(2400)}}run().then(()=>document.body.dataset.complete='true');</script></body></html>"""
        html_file = temporary_directory / "video.html"
        html_file.write_text(video_html, encoding="utf-8")
        width = 1280
        height = max(720, round(width / aspect_ratio))
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": width, "height": height},
                record_video_dir=str(temporary_directory),
                record_video_size={"width": width, "height": height},
            )
            page = context.new_page()
            page.goto(html_file.as_uri(), wait_until="load")
            page.wait_for_function("document.body.dataset.complete === 'true'", timeout=300000)
            page.close()
            context.close()
            browser.close()

        recordings = list(temporary_directory.glob("*.webm"))
        if not recordings:
            raise RuntimeError("Playwright did not produce a video recording.")
        subprocess.run(
            ["ffmpeg", "-y", "-i", str(recordings[0]), "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(video_file)],
            check=True,
            capture_output=True,
            text=True,
        )
    return video_file


def build_package_readme():
    readme_file = BASE_DIR / "README.txt"
    return readme_file.read_text(encoding="utf-8")


def remove_standalone_customization_controls(index_html: str) -> str:
    for tag, element_id in (
        ("button", "customizeButton"),
        ("aside", "customizePanel"),
        ("button", "customizeBackdrop"),
    ):
        pattern = (
            rf"<{tag}\b(?=[^>]*\bid=[\"']{re.escape(element_id)}[\"'])"
            rf"[^>]*>.*?</{tag}\s*>"
        )
        index_html, removed_count = re.subn(
            pattern,
            "",
            index_html,
            count=1,
            flags=re.IGNORECASE | re.DOTALL,
        )
        if removed_count != 1:
            raise RuntimeError(
                f"Expected exactly one {tag} with id '{element_id}' in the flipbook template."
            )
    return index_html


def build_standalone_zip(job_id: str, page_files: list[Path], pdf_information: dict | None = None):
    local_pages = [f"pages/{page.name}" for page in page_files]
    local_data = dict(pdf_information or {})
    local_data["job_id"] = job_id

    job_directory = get_job_directory(job_id)
    search_index_file = job_directory / "search-index.json"
    try:
        search_index = json.loads(search_index_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        search_index = {"has_text": False, "pages": []}
    if page_files and not search_index.get("has_text") and (
        "ocr_pages" not in search_index or search_index.get("ocr_error")
    ):
        create_search_index_from_page_images(page_files, job_directory)
        try:
            search_index = json.loads(search_index_file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            search_index = {"has_text": False, "pages": []}
    local_data["search_index"] = search_index

    settings = load_job_settings(job_id, local_data.get("title") or "Flipbook")
    branding_files = []
    for setting_name in ("logo", "backgroundImage"):
        asset_url = settings.get(setting_name, "")
        asset_prefix = f"/generated/{job_id}/"
        if not asset_url.startswith(asset_prefix):
            continue
        asset_path = job_directory / Path(asset_url[len(asset_prefix):]).name
        if asset_path.is_file():
            asset_arcname = f"assets/branding/{asset_path.name}"
            settings[setting_name] = asset_arcname
            branding_files.append((asset_path, f"flipbook/{asset_arcname}"))
        else:
            settings[setting_name] = ""
    local_data["settings"] = settings

    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        index_html = (STATIC_DIR / "flipbook.html").read_text(encoding="utf-8")
        index_html = remove_standalone_customization_controls(index_html)
        index_html = index_html.replace(
            'href="/static/css/style.css?v=4"',
            'href="css/style.css"',
        )
        index_html = index_html.replace(
            'src="/static/js/jquery.js"',
            'src="js/jquery.js"',
        )
        index_html = index_html.replace(
            'src="/static/js/turn.js"',
            'src="js/turn.js"',
        )
        index_html = index_html.replace(
            'src="/static/js/flipbook.js?v=7"',
            'src="js/flipbook.js"',
        )
        config_script = (
            "<script>"
            f"window.FLIPBOOK_LOCAL_PAGES={json.dumps(local_pages)};"
            "window.FLIPBOOK_DATA="
            + json.dumps(local_data, ensure_ascii=False).replace("<", "\\u003c")
            + ";"
            'window.FLIPBOOK_SOUND_URL="assets/page-turn.mp3";'
            "</script>"
        )
        index_html = index_html.replace('<script\n    src="js/jquery.js"', f"{config_script}\n<script\n    src=\"js/jquery.js\"")
        archive.writestr("flipbook/index.html", index_html)
        archive.writestr("flipbook/css/style.css", (STATIC_DIR / "css" / "style.css").read_bytes())
        archive.writestr("flipbook/js/jquery.js", (STATIC_DIR / "js" / "jQuery.js").read_bytes())
        archive.writestr("flipbook/js/turn.js", (STATIC_DIR / "js" / "turn.js").read_bytes())
        archive.writestr("flipbook/js/flipbook.js", (STATIC_DIR / "js" / "flipbook.js").read_bytes())
        for asset_path, asset_arcname in branding_files:
            archive.write(asset_path, arcname=asset_arcname)
        sound_file = STATIC_DIR / "sounds" / "page-turn.mp3"
        if sound_file.exists():
            archive.write(sound_file, arcname="flipbook/assets/page-turn.mp3")
        for page_file in page_files:
            archive.write(page_file, arcname=f"flipbook/pages/{page_file.name}")
    return zip_buffer.getvalue()


@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...), title: str = Form(default="")):
    upload_path = None
    job_directory = None
    try:
        if not file.filename:
            return JSONResponse(status_code=400, content={"success": False, "message": "No file was selected."})
        original_filename = file.filename
        if Path(original_filename).suffix.lower() != ".pdf":
            return JSONResponse(status_code=400, content={"success": False, "message": "Only PDF files are supported."})
        job_id = uuid.uuid4().hex
        upload_path = UPLOAD_DIR / f"{job_id}.pdf"
        job_directory = GENERATED_DIR / job_id
        await save_uploaded_pdf(file, upload_path)
        valid, validation_error = validate_pdf(upload_path)
        if not valid:
            raise ValueError(validation_error)
        pdf_information = get_pdf_information(upload_path)
        custom_title = (title or "").strip()
        if custom_title:
            pdf_information["title"] = custom_title
        elif not pdf_information.get("title"):
            pdf_information["title"] = "Flipbook"
        pages = render_pdf_pages(upload_path, job_directory)
        pdf_information["text_search_available"] = create_search_index(upload_path, job_directory)
        (job_directory / "metadata.json").write_text(json.dumps(pdf_information, indent=2), encoding="utf-8")
        default_settings = normalize_job_settings({}, pdf_information.get("title") or custom_title or "Flipbook")
        write_job_settings(job_directory, default_settings)
        safe_delete_file(upload_path)
        upload_path = None
        return JSONResponse(content={"success": True, "job_id": job_id, "filename": original_filename, **pdf_information, "pages": pages})
    except ValueError as error:
        safe_delete_file(upload_path)
        safe_delete_directory(job_directory)
        return JSONResponse(status_code=400, content={"success": False, "message": str(error)})
    except Exception as error:
        print("PDF processing error:", repr(error))
        safe_delete_file(upload_path)
        safe_delete_directory(job_directory)
        return JSONResponse(status_code=500, content={"success": False, "message": "An error occurred while processing the PDF.", "error": str(error)})


@app.get("/api/job/{job_id}")
async def get_flipbook_job(job_id: str):
    if not validate_job_id(job_id):
        return JSONResponse(status_code=400, content={"success": False, "message": "Invalid job ID."})
    job_directory = get_job_directory(job_id)
    if not job_directory.exists():
        return JSONResponse(status_code=404, content={"success": False, "message": "Flipbook not found."})
    page_files = sorted(job_directory.glob("page-*.webp"))
    if not page_files:
        return JSONResponse(status_code=404, content={"success": False, "message": "No generated pages were found."})
    metadata = {}
    metadata_file = job_directory / "metadata.json"
    if metadata_file.exists():
        try:
            metadata = normalize_job_metadata(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    default_title = metadata.get("title") or "Flipbook"
    job_settings = load_job_settings(job_id, default_title)
    response = {"success": True, "job_id": job_id, "page_count": len(page_files), **metadata, "settings": job_settings, "pages": [f"/generated/{job_id}/{page.name}" for page in page_files]}
    return JSONResponse(content=response)


@app.get("/api/job/{job_id}/settings")
async def get_flipbook_settings(job_id: str):
    if not validate_job_id(job_id):
        return JSONResponse(status_code=400, content={"success": False, "message": "Invalid job ID."})
    job_directory = get_job_directory(job_id)
    if not job_directory.exists():
        return JSONResponse(status_code=404, content={"success": False, "message": "Flipbook not found."})
    metadata = {}
    metadata_file = job_directory / "metadata.json"
    if metadata_file.exists():
        try:
            metadata = normalize_job_metadata(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass
    settings = load_job_settings(job_id, metadata.get("title") or "Flipbook")
    return JSONResponse(content={"success": True, "job_id": job_id, "settings": settings})


@app.post("/api/job/{job_id}/settings")
async def save_flipbook_settings(
    job_id: str,
    settings: str = Form(default="{}"),
    logo: UploadFile | None = File(default=None),
    background: UploadFile | None = File(default=None),
):
    if not validate_job_id(job_id):
        return JSONResponse(status_code=400, content={"success": False, "message": "Invalid job ID."})
    job_directory = get_job_directory(job_id)
    if not job_directory.exists():
        return JSONResponse(status_code=404, content={"success": False, "message": "Flipbook not found."})

    try:
        payload = json.loads(settings or "{}")
    except (TypeError, ValueError):
        return JSONResponse(status_code=400, content={"success": False, "message": "Settings data is not valid JSON."})

    metadata = {}
    metadata_file = job_directory / "metadata.json"
    if metadata_file.exists():
        try:
            metadata = normalize_job_metadata(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass

    current_settings = load_job_settings(job_id, metadata.get("title") or "Flipbook")
    merged_settings = normalize_job_settings(payload, metadata.get("title") or "Flipbook")
    merged_settings = {**current_settings, **merged_settings}

    try:
        if logo is not None:
            saved_logo_path = await save_uploaded_asset(logo, job_directory / "logo")
            if saved_logo_path is not None:
                merged_settings["logo"] = f"/generated/{job_id}/{saved_logo_path.name}"
                merged_settings["showLogo"] = True
        elif bool(payload.get("removeLogo")):
            merged_settings["logo"] = ""
            merged_settings["showLogo"] = False

        if background is not None:
            saved_background_path = await save_uploaded_asset(background, job_directory / "background")
            if saved_background_path is not None:
                merged_settings["backgroundImage"] = f"/generated/{job_id}/{saved_background_path.name}"
        elif bool(payload.get("removeBackground")):
            merged_settings["backgroundImage"] = ""

        if payload.get("title") is not None:
            merged_settings["title"] = sanitize_custom_text(payload.get("title"), 120)
        if payload.get("subtitle") is not None:
            merged_settings["subtitle"] = sanitize_custom_text(payload.get("subtitle"), 120)
        if payload.get("companyName") is not None:
            merged_settings["companyName"] = sanitize_custom_text(payload.get("companyName"), 120)

        merged_settings = normalize_job_settings(merged_settings, metadata.get("title") or "Flipbook")
        write_job_settings(job_directory, merged_settings)
        return JSONResponse(content={"success": True, "job_id": job_id, "settings": merged_settings})
    except ValueError as error:
        return JSONResponse(status_code=400, content={"success": False, "message": str(error)})
    except Exception as error:
        print("Custom settings error:", repr(error))
        return JSONResponse(status_code=500, content={"success": False, "message": "Could not save these customization settings.", "error": str(error)})


@app.get("/api/job/{job_id}/search-index")
async def get_flipbook_search_index(job_id: str):
    if not validate_job_id(job_id):
        return JSONResponse(status_code=400, content={"success": False, "message": "Invalid job ID."})
    job_directory = get_job_directory(job_id)
    index_file = job_directory / "search-index.json"
    page_files = sorted(job_directory.glob("page-*.webp"))
    if not index_file.is_file() and not page_files:
        return JSONResponse(status_code=404, content={"success": False, "message": "Search data is not available for this flipbook."})
    try:
        search_index = json.loads(index_file.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        search_index = {"has_text": False, "pages": []}
    if (
        not search_index.get("has_text")
        and ("ocr_pages" not in search_index or search_index.get("ocr_error"))
    ):
        if page_files:
            await asyncio.to_thread(
                create_search_index_from_page_images,
                page_files,
                job_directory,
            )
            try:
                search_index = json.loads(index_file.read_text(encoding="utf-8"))
            except (OSError, ValueError):
                return JSONResponse(status_code=500, content={"success": False, "message": "OCR search data could not be loaded."})
    elif not index_file.is_file():
        return JSONResponse(status_code=500, content={"success": False, "message": "Search data could not be created for this flipbook."})
    return JSONResponse(content=search_index)


@app.get("/api/job/{job_id}/download")
async def download_flipbook_job(job_id: str):
    if not validate_job_id(job_id):
        return JSONResponse(status_code=400, content={"success": False, "message": "Invalid job ID."})
    job_directory = get_job_directory(job_id)
    if not job_directory.exists():
        return JSONResponse(status_code=404, content={"success": False, "message": "Flipbook not found."})
    page_files = sorted(job_directory.glob("page-*.webp"))
    if not page_files:
        return JSONResponse(status_code=404, content={"success": False, "message": "No generated pages were found."})

    metadata_file = job_directory / "metadata.json"
    pdf_information = {}
    if metadata_file.exists():
        try:
            pdf_information = normalize_job_metadata(json.loads(metadata_file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            pass

    inner_zip = build_standalone_zip(job_id, page_files, pdf_information)
    package_buffer = io.BytesIO()
    with zipfile.ZipFile(package_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        with zipfile.ZipFile(io.BytesIO(inner_zip), "r") as flipbook_archive:
            for entry in flipbook_archive.infolist():
                archive.writestr(entry, flipbook_archive.read(entry.filename))
        archive.writestr("README.txt", build_package_readme())

    return Response(
        content=package_buffer.getvalue(),
        media_type="application/zip",
        headers={
            "Content-Disposition": 'attachment; filename="Flipbook_Client_Package.zip"',
        },
    )


@app.get("/api/health")
async def health():
    return {"status": "ok", "application": "PDF Flipbook Agent", "version": "1.0.0", "pdf_engine": "PyMuPDF", "render_format": "WebP", "render_dpi": PDF_DPI, "webp_quality": WEBP_QUALITY}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)
