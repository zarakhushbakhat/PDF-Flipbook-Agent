
# ============================================================
# PDF FLIPBOOK AGENT
# MAIN APPLICATION
# ============================================================

import io
import json
import re
import shutil
import time
import uuid
import zipfile
from pathlib import Path

import pymupdf
from fastapi import FastAPI, File, Request, UploadFile
from fastapi.responses import HTMLResponse, JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates


# ============================================================
# PROJECT PATHS
# ============================================================

BASE_DIR = Path(__file__).resolve().parent
UPLOAD_DIR = BASE_DIR / "uploads"
GENERATED_DIR = BASE_DIR / "generated"
TEMP_DIR = BASE_DIR / "temp"
TEMPLATES_DIR = BASE_DIR / "templates"
STATIC_DIR = BASE_DIR / "static"

UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
GENERATED_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)
TEMPLATES_DIR.mkdir(parents=True, exist_ok=True)
STATIC_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# SETTINGS
# ============================================================

PDF_DPI = 300
MAX_FILE_SIZE = 100 * 1024 * 1024
VALID_JOB_ID_PATTERN = re.compile(r"^[a-fA-F0-9]{32}$")
WEBP_QUALITY = 95


# ============================================================
# FASTAPI APP
# ============================================================

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


# ============================================================
# HOME PAGE
# ============================================================

@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    return templates.TemplateResponse(request=request, name="index.html")


# ============================================================
# JOB ID VALIDATION
# ============================================================

def validate_job_id(job_id: str | None):
    if not job_id:
        return False
    return bool(VALID_JOB_ID_PATTERN.fullmatch(job_id))


# ============================================================
# PDF VALIDATION
# ============================================================

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


# ============================================================
# GET PDF INFORMATION
# ============================================================

def get_pdf_information(pdf_path: Path):
    document = None
    try:
        document = pymupdf.open(str(pdf_path))
        metadata = document.metadata or {}
        return {
            "page_count": document.page_count,
            "title": metadata.get("title") or "",
            "author": metadata.get("author") or "",
            "subject": metadata.get("subject") or "",
            "keywords": metadata.get("keywords") or "",
        }
    finally:
        if document is not None:
            document.close()


# ============================================================
# RENDER ONE PDF PAGE
# ============================================================

def render_page_to_webp(page, output_file: Path):
    zoom = PDF_DPI / 72.0
    matrix = pymupdf.Matrix(zoom, zoom)
    pixmap = page.get_pixmap(matrix=matrix, alpha=False)
    try:
        pixmap.pil_save(str(output_file), format="WEBP", quality=WEBP_QUALITY, method=6)
    finally:
        pixmap = None


# ============================================================
# RENDER ALL PDF PAGES
# ============================================================

def render_pdf_pages(pdf_path: Path, output_directory: Path):
    output_directory = Path(output_directory)
    output_directory.mkdir(parents=True, exist_ok=True)

    document = None
    generated_pages = []

    try:
        document = pymupdf.open(str(pdf_path))
        for page_number in range(document.page_count):
            page = document.load_page(page_number)
            filename = f"page-{page_number + 1:04d}.webp"
            output_file = output_directory / filename
            render_page_to_webp(page, output_file)
            generated_pages.append(f"/generated/{output_directory.name}/{filename}")
        return generated_pages
    finally:
        if document is not None:
            document.close()


# ============================================================
# SAVE UPLOADED PDF
# ============================================================

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


# ============================================================
# SAFE FILE DELETE
# ============================================================

def safe_delete_file(file_path: Path | None):
    if file_path is None:
        return
    try:
        if file_path.exists():
            file_path.unlink()
    except PermissionError:
        print(f"Warning: Could not delete {file_path} because it is still in use.")
    except Exception as error:
        print(f"Warning: Could not delete {file_path}: {error}")


# ============================================================
# SAFE DIRECTORY DELETE
# ============================================================

def safe_delete_directory(directory: Path | None):
    if directory is None:
        return
    try:
        if directory.exists():
            shutil.rmtree(directory, ignore_errors=True)
    except Exception as error:
        print(f"Warning: Could not remove {directory}: {error}")


def cleanup_stale_generated_assets(max_age_hours: int = 24):
    if not GENERATED_DIR.exists():
        return

    cutoff = time.time() - (max_age_hours * 60 * 60)

    for child in GENERATED_DIR.iterdir():
        if not child.is_dir():
            continue

        try:
            if child.stat().st_mtime < cutoff:
                safe_delete_directory(child)
        except OSError:
            continue


# ============================================================
# CREATE STANDALONE ZIP PACKAGE
# ============================================================

def build_standalone_zip(job_id: str, page_files: list[Path]):
    local_pages = [f"pages/{page_file.name}" for page_file in page_files]
    zip_buffer = io.BytesIO()

    with zipfile.ZipFile(zip_buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        index_html = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Flipbook</title>
    <link rel="stylesheet" href="css/style.css" />
</head>
<body>
    <header class="topbar">
        <div class="brand">
            <span class="brand-icon">📖</span>
            <span id="bookTitle">Flipbook</span>
        </div>

        <div class="top-actions">
            <button id="zoomOut" class="tool-button" title="Zoom out">−</button>
            <span id="zoomValue" class="zoom-value">100%</span>
            <button id="zoomIn" class="tool-button" title="Zoom in">+</button>
            <button id="fullscreenButton" class="tool-button" title="Fullscreen">⛶</button>
        </div>
    </header>

    <main class="viewer" id="viewer">
        <button id="previousButton" class="navigation-button previous" aria-label="Previous page">‹</button>
        <div class="book-stage" id="bookStage">
            <div class="flipbook" id="book"></div>
        </div>
        <button id="nextButton" class="navigation-button next" aria-label="Next page">›</button>
    </main>

    <footer class="controls">
        <button id="firstButton" class="control-button" title="First page">⏮</button>
        <button id="previousBottom" class="control-button" title="Previous page">←</button>
        <div class="page-info">
            <span id="currentPage">1</span>
            <span>/</span>
            <span id="totalPages">1</span>
        </div>
        <button id="nextBottom" class="control-button" title="Next page">→</button>
        <button id="lastButton" class="control-button" title="Last page">⏭</button>
    </footer>

    <div id="loading" class="loading">
        <div class="loading-spinner"></div>
        <p>Preparing your flipbook...</p>
    </div>

    <script src="js/jquery.js"></script>
    <script src="js/turn.js"></script>
    <script>
        window.FLIPBOOK_LOCAL_PAGES = {json.dumps(local_pages)};
    </script>
    <script src="js/flipbook.js"></script>
</body>
</html>
"""

        archive.writestr("index.html", index_html.strip() + "\n")
        archive.writestr("css/style.css", (STATIC_DIR / "css" / "style.css").read_bytes())
        archive.writestr("js/jquery.js", (STATIC_DIR / "js" / "jQuery.js").read_bytes())
        archive.writestr("js/turn.js", (STATIC_DIR / "js" / "turn.js").read_bytes())
        archive.writestr("js/flipbook.js", (STATIC_DIR / "js" / "flipbook.js").read_bytes())

        for page_file in page_files:
            archive.write(page_file, arcname=f"pages/{page_file.name}")

    return zip_buffer.getvalue()


# ============================================================
# UPLOAD PDF API
# ============================================================

@app.post("/api/upload")
async def upload_pdf(file: UploadFile = File(...)):
    upload_path = None
    job_directory = None

    try:
        if not file.filename:
            return JSONResponse(status_code=400, content={"success": False, "message": "No file was selected."})

        original_filename = file.filename
        extension = Path(original_filename).suffix.lower()
        if extension != ".pdf":
            return JSONResponse(status_code=400, content={"success": False, "message": "Only PDF files are supported."})

        job_id = uuid.uuid4().hex
        upload_path = UPLOAD_DIR / f"{job_id}.pdf"
        job_directory = GENERATED_DIR / job_id

        await save_uploaded_pdf(file, upload_path)

        valid, validation_error = validate_pdf(upload_path)
        if not valid:
            raise ValueError(validation_error)

        pdf_information = get_pdf_information(upload_path)
        pages = render_pdf_pages(upload_path, job_directory)

        safe_delete_file(upload_path)
        upload_path = None

        return JSONResponse(
            content={
                "success": True,
                "job_id": job_id,
                "filename": original_filename,
                "page_count": pdf_information["page_count"],
                "title": pdf_information["title"],
                "author": pdf_information["author"],
                "subject": pdf_information["subject"],
                "keywords": pdf_information["keywords"],
                "pages": pages,
            }
        )

    except ValueError as error:
        safe_delete_file(upload_path)
        safe_delete_directory(job_directory)
        return JSONResponse(status_code=400, content={"success": False, "message": str(error)})
    except Exception as error:
        print("PDF processing error:", repr(error))
        safe_delete_file(upload_path)
        safe_delete_directory(job_directory)
        return JSONResponse(
            status_code=500,
            content={"success": False, "message": "An error occurred while processing the PDF.", "error": str(error)},
        )


# ============================================================
# GET FLIPBOOK JOB
# ============================================================

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

    pages = [f"/generated/{job_id}/{page_file.name}" for page_file in page_files]
    return JSONResponse(content={"success": True, "job_id": job_id, "page_count": len(pages), "pages": pages})


# ============================================================
# DOWNLOAD FLIPBOOK ZIP
# ============================================================

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

    zip_bytes = build_standalone_zip(job_id, page_files)

    return Response(
        content=zip_bytes,
        media_type="application/zip",
        headers={"Content-Disposition": f'attachment; filename="flipbook-{job_id}.zip"'},
    )


# ============================================================
# HEALTH CHECK
# ============================================================

@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "application": "PDF Flipbook Agent",
        "version": "1.0.0",
        "pdf_engine": "PyMuPDF",
        "render_format": "WebP",
        "render_dpi": PDF_DPI,
        "webp_quality": WEBP_QUALITY,
    }


# ============================================================
# RUN SERVER
# ============================================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000, reload=False)

