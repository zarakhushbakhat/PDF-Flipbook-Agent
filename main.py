import asyncio
import importlib
import io
import json
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

PDF_DPI = 600
MAX_FILE_SIZE = 100 * 1024 * 1024
VALID_JOB_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{32}$")
WEBP_QUALITY = 98

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


def build_standalone_zip(job_id: str, page_files: list[Path], pdf_information: dict | None = None):
    local_pages = [f"pages/{page.name}" for page in page_files]
    local_data = pdf_information or {}
    zip_buffer = io.BytesIO()
    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        index_html = f"""<!DOCTYPE html><html lang=\"en\"><head><meta charset=\"UTF-8\"><meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\"><title>Flipbook</title><link rel=\"stylesheet\" href=\"css/style.css\"></head><body><header class=\"topbar\"><div class=\"brand\"><span class=\"brand-icon\">📖</span><span id=\"bookTitle\">Flipbook</span></div><div class=\"top-actions\"><button id=\"zoomOut\" class=\"tool-button\" title=\"Zoom out\">−</button><span id=\"zoomValue\" class=\"zoom-value\">100%</span><button id=\"zoomIn\" class=\"tool-button\" title=\"Zoom in\">+</button><button id=\"fullscreenButton\" class=\"tool-button\" title=\"Fullscreen\">⛶</button></div></header><main class=\"viewer\" id=\"viewer\"><button id=\"previousButton\" class=\"navigation-button previous\" aria-label=\"Previous page\">‹</button><div class=\"book-stage\" id=\"bookStage\"><div class=\"flipbook\" id=\"book\"></div></div><button id=\"nextButton\" class=\"navigation-button next\" aria-label=\"Next page\">›</button></main><footer class=\"controls\"><button id=\"firstButton\" class=\"control-button\" title=\"First page\">⏮</button><button id=\"previousBottom\" class=\"control-button\" title=\"Previous page\">←</button><div class=\"page-info\"><span id=\"currentPage\">1</span><span>/</span><span id=\"totalPages\">1</span></div><button id=\"nextBottom\" class=\"control-button\" title=\"Next page\">→</button><button id=\"lastButton\" class=\"control-button\" title=\"Last page\">⏭</button></footer><div id=\"loading\" class=\"loading\"><div class=\"loading-spinner\"></div><p>Preparing your flipbook...</p></div><script src=\"js/jquery.js\"></script><script src=\"js/turn.js\"></script><script>window.FLIPBOOK_LOCAL_PAGES={json.dumps(local_pages)};window.FLIPBOOK_DATA={json.dumps(local_data)};window.FLIPBOOK_SOUND_URL=\"assets/page-turn.mp3\";</script><script src=\"js/flipbook.js\"></script></body></html>"""
        archive.writestr("flipbook/index.html", index_html + "\n")
        archive.writestr("flipbook/css/style.css", (STATIC_DIR / "css" / "style.css").read_bytes())
        archive.writestr("flipbook/js/jquery.js", (STATIC_DIR / "js" / "jQuery.js").read_bytes())
        archive.writestr("flipbook/js/turn.js", (STATIC_DIR / "js" / "turn.js").read_bytes())
        archive.writestr("flipbook/js/flipbook.js", (STATIC_DIR / "js" / "flipbook.js").read_bytes())
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
        (job_directory / "metadata.json").write_text(json.dumps(pdf_information, indent=2), encoding="utf-8")
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
    return JSONResponse(content={"success": True, "job_id": job_id, "page_count": len(page_files), **metadata, "pages": [f"/generated/{job_id}/{page.name}" for page in page_files]})


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
