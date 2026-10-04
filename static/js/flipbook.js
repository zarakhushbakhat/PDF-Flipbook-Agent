// ============================================================
// PDF FLIPBOOK AGENT
// HIGH-RESOLUTION PROGRESSIVE TURN.JS VIEWER
// ============================================================
//
// Features:
// 1. Loads flipbook quickly
// 2. Keeps readable 180-DPI source images
// 3. Does NOT preload the entire PDF
// 4. First pages load immediately
// 5. Remaining pages load progressively
// 6. High-resolution images remain available for zoom
// 7. Turn.js page-turn animation
// 8. Navigation buttons
// 9. Keyboard navigation
// 10. Touch/swipe navigation
// 11. Zoom
// 12. Fullscreen
// 13. Responsive resizing
//
// ============================================================


// ============================================================
// GLOBAL VARIABLES
// ============================================================

let flipbookData = null;

let pages = [];

let totalPages = 0;

let currentPage = 1;

let zoomLevel = 1.0;

let isReady = false;

let isPageTurning = false;

const DEFAULT_FLIPBOOK_SETTINGS = {
    theme: "classic",
    mode: "light",
    backgroundColor: "#f3f3f3",
    viewerBackground: "#f8f8f8",
    toolbarColor: "#ffffff",
    accentColor: "#2d3748",
    title: "",
    subtitle: "",
    companyName: "",
    showLogo: false,
    logo: "",
    backgroundImage: "",
    showSearch: true,
    showThumbnails: true,
    showZoom: true,
    showFullscreen: true,
    showShare: true,
    showDownload: true,
    pageShadow: true,
    pageTurnSound: false,
    toolbarPosition: "top"
};

let flipbookSettings = { ...DEFAULT_FLIPBOOK_SETTINGS };

// ============================================================
// PAGE TURN SOUND
// ============================================================

const pageTurnSound =
    new Audio(
        window.FLIPBOOK_SOUND_URL ||
        "sounds/page-turn.mp3"
    );

pageTurnSound.preload = "auto";
pageTurnSound.volume = 0.45;

let pageTurnSoundUnlocked = false;

let pageTurnSoundTimer = null;


function unlockPageTurnSound() {

    if (pageTurnSoundUnlocked) {
        return;
    }

    pageTurnSound.muted = true;

    pageTurnSound.play().then(
        function () {
            pageTurnSound.pause();
            pageTurnSound.currentTime = 0;
            pageTurnSound.muted = false;
            pageTurnSoundUnlocked = true;
        }
    ).catch(
        function (error) {
            console.warn(
                "Page-turn sound could not be unlocked:",
                error
            );
            pageTurnSound.muted = false;
        }
    );

}


// Play page-turn sound
function playPageTurnSound() {

    if (!flipbookSettings || !flipbookSettings.pageTurnSound) {
        return;
    }

    try {

        pageTurnSound.currentTime = 0;

        pageTurnSound.play().catch(
            function (error) {

                console.warn(
                    "Page-turn sound could not play:",
                    error
                );

            }
        );

    } catch (error) {

        console.warn(
            "Page-turn sound error:",
            error
        );

    }

}


function schedulePageTurnSound() {

    clearTimeout(pageTurnSoundTimer);

    pageTurnSoundTimer = setTimeout(
        playPageTurnSound,
        140
    );

}


document.addEventListener(
    "pointerdown",
    unlockPageTurnSound,
    { once: true, passive: true }
);

document.addEventListener(
    "keydown",
    unlockPageTurnSound,
    { once: true, passive: true }
);

// ============================================================
// PROGRESSIVE LOADING SETTINGS
// ============================================================

// Number of pages to load before displaying the book.
//
// We keep this small so the first visible pages appear fast,
// while the rest are loaded lazily in the background.

const INITIAL_PAGES_TO_LOAD = 2;


// Number of pages to load around the page
// the user is currently viewing.

const NEARBY_PAGES_TO_LOAD = 3;


// Maximum number of images that can load
// simultaneously in the background.

const MAX_CONCURRENT_LOADS = 4;


// Keep track of pages that are already loaded.

const loadedPages = new Set();


// Keep track of pages currently being loaded.

const loadingPages = new Set();

const pageElements = new Map();


// ============================================================
// GET ELEMENTS
// ============================================================

const book =
    document.getElementById("book");

const bookStage =
    document.getElementById("bookStage");

const loading =
    document.getElementById("loading");

const bookTitle =
    document.getElementById("bookTitle");

const bookSubtitle =
    document.getElementById("bookSubtitle");

const brandLogo =
    document.getElementById("brandLogo");

const currentPageElement =
    document.getElementById("currentPage");

const totalPagesElement =
    document.getElementById("totalPages");

const zoomValue =
    document.getElementById("zoomValue");

const previousButton =
    document.getElementById("previousButton");

const nextButton =
    document.getElementById("nextButton");

const previousBottom =
    document.getElementById("previousBottom");

const nextBottom =
    document.getElementById("nextBottom");

const firstButton =
    document.getElementById("firstButton");

const lastButton =
    document.getElementById("lastButton");

const zoomIn =
    document.getElementById("zoomIn");

const zoomOut =
    document.getElementById("zoomOut");

const fullscreenButton =
    document.getElementById("fullscreenButton");

const backToPagesButton =
    document.getElementById("backToPagesButton");

const thumbnailSidebar = document.getElementById("thumbnailSidebar");
const thumbnailList = document.getElementById("thumbnailList");
const thumbnailsButton = document.getElementById("thumbnailsButton");
const closeThumbnailsButton = document.getElementById("closeThumbnailsButton");
const sidebarBackdrop = document.getElementById("sidebarBackdrop");
const thumbnailSidebarResizeHandle = document.getElementById("thumbnailSidebarResizeHandle");
const searchButton = document.getElementById("searchButton");
const searchPanel = document.getElementById("searchPanel");
const searchForm = document.getElementById("searchForm");
const searchInput = document.getElementById("searchInput");
const searchSummary = document.getElementById("searchSummary");
const searchResults = document.getElementById("searchResults");
const previousResultButton = document.getElementById("previousResultButton");
const nextResultButton = document.getElementById("nextResultButton");
const shareButton = document.getElementById("shareButton");
const downloadButton = document.getElementById("downloadButton");
const customizeButton = document.getElementById("customizeButton");
const customizePanel = document.getElementById("customizePanel");
const customizeBackdrop = document.getElementById("customizeBackdrop");
const closeCustomizeButton = document.getElementById("closeCustomizeButton");
const customizeForm = document.getElementById("customizeForm");
const saveSettingsButton = document.getElementById("saveSettingsButton");
const resetSettingsButton = document.getElementById("resetSettingsButton");
const customizeThemeInputs = Array.from(document.querySelectorAll('input[name="theme"]'));
const customizeModeInputs = Array.from(document.querySelectorAll('input[name="mode"]'));
const backgroundColorInput = document.getElementById("backgroundColorInput");
const viewerBackgroundInput = document.getElementById("viewerBackgroundInput");
const toolbarColorInput = document.getElementById("toolbarColorInput");
const accentColorInput = document.getElementById("accentColorInput");
const backgroundImageInput = document.getElementById("backgroundImageInput");
const logoInput = document.getElementById("logoInput");
const titleInput = document.getElementById("titleInput");
const subtitleInput = document.getElementById("subtitleInput");
const companyNameInput = document.getElementById("companyNameInput");
const pageShadowCheckbox = document.getElementById("pageShadowCheckbox");
const pageTurnSoundCheckbox = document.getElementById("pageTurnSoundCheckbox");
const showSearchCheckbox = document.getElementById("showSearchCheckbox");
const showThumbnailsCheckbox = document.getElementById("showThumbnailsCheckbox");
const showZoomCheckbox = document.getElementById("showZoomCheckbox");
const showFullscreenCheckbox = document.getElementById("showFullscreenCheckbox");
const showShareCheckbox = document.getElementById("showShareCheckbox");
const showDownloadCheckbox = document.getElementById("showDownloadCheckbox");
const removeBackgroundCheckbox = document.getElementById("removeBackgroundCheckbox");
const removeLogoCheckbox = document.getElementById("removeLogoCheckbox");

let searchablePages = [];
let searchMatches = [];
let activeSearchResult = -1;
let searchIndexError = "";


// ============================================================
// GET JOB ID FROM URL
// ============================================================

const params =
    new URLSearchParams(
        window.location.search
    );

const jobId =
    params.get("job_id");

const localPageList =
    window.FLIPBOOK_LOCAL_PAGES || null;


// ============================================================
// SAFE ELEMENT CHECK
// ============================================================

function elementExists(element) {

    return element !== null;

}


// ============================================================
// SHOW ERROR
// ============================================================

function showError(message) {

    if (!loading) {
        return;
    }

    loading.innerHTML = `
        <div class="error-icon">
            ⚠
        </div>

        <p>
            ${escapeHtml(message)}
        </p>
    `;

}


// ============================================================
// ESCAPE HTML
// ============================================================

function escapeHtml(value) {

    return String(value)
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");

}


// ============================================================
// LOAD FLIPBOOK DATA
// ============================================================

async function loadFlipbookData() {

    if (
        Array.isArray(localPageList) &&
        localPageList.length > 0
    ) {

        flipbookData = {
            success: true,
            job_id: "local",
            pages: localPageList,
            ...(window.FLIPBOOK_DATA || {})
        };

        pages = localPageList;
        totalPages = pages.length;

        return true;
    }


    if (!jobId) {

        showError(
            "Flipbook job was not found."
        );

        return false;
    }


    try {

        const response =
            await fetch(
                `/api/job/${encodeURIComponent(jobId)}`
            );


        const data =
            await response.json();


        if (
            !response.ok ||
            !data.success
        ) {

            throw new Error(
                data.message ||
                "Could not load flipbook."
            );

        }


        flipbookData =
            data;


        pages =
            data.pages || [];


        totalPages =
            pages.length;


        if (totalPages === 0) {

            throw new Error(
                "No generated pages were found."
            );

        }


        console.log(
            "Flipbook loaded:"
        );


        console.log(
            "Job ID:",
            data.job_id
        );


        console.log(
            "Total pages:",
            totalPages
        );


        return true;


    } catch (error) {

        console.error(
            "Could not load flipbook:",
            error
        );


        showError(
            error.message ||
            "Could not load the flipbook."
        );


        return false;

    }

}


// ============================================================
// SET BOOK TITLE
// ============================================================

function normalizeHexColor(value, fallback) {
    if (!value || typeof value !== "string") {
        return fallback;
    }
    const clean = value.trim();
    if (!/^#[0-9a-fA-F]{6}$/.test(clean)) {
        return fallback;
    }
    return clean.toLowerCase();
}

function normalizeText(value, fallback = "") {
    if (value === null || value === undefined) {
        return fallback;
    }
    const text = String(value).replace(/\u0000/g, "").trim();
    return text || fallback;
}

function getThemePalette(theme, mode) {
    const isDark = mode === "dark";
    const themes = {
        classic: {
            toolbarBackground: "#ffffff",
            viewerBackground: "#f3f3f3",
            sidebarBackground: "#191919",
            panelBackground: "#16171b",
            accent: "#2d3748",
            text: isDark ? "#f4f4f4" : "#1d1d1d",
            toolbarText: isDark ? "#f4f4f4" : "#111111",
            buttonBackground: isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)",
            border: "rgba(255,255,255,0.12)"
        },
        minimal: {
            toolbarBackground: isDark ? "#151515" : "#f5f5f5",
            viewerBackground: isDark ? "#0d0d0d" : "#fafafa",
            sidebarBackground: isDark ? "#121212" : "#f0f0f0",
            panelBackground: isDark ? "#171819" : "#f5f5f5",
            accent: "#3a3a3a",
            text: isDark ? "#efefef" : "#1f1f1f",
            toolbarText: isDark ? "#f6f6f6" : "#111111",
            buttonBackground: isDark ? "rgba(255,255,255,0.07)" : "rgba(0,0,0,0.04)",
            border: isDark ? "rgba(255,255,255,0.1)" : "rgba(15,15,15,0.08)"
        },
        magazine: {
            toolbarBackground: "#1b1a17",
            viewerBackground: "#ebe5dc",
            sidebarBackground: "#211f1b",
            panelBackground: "#1d1b19",
            accent: "#a16f2c",
            text: isDark ? "#f1efe8" : "#221c18",
            toolbarText: "#f5efe8",
            buttonBackground: "rgba(255,255,255,0.08)",
            border: "rgba(255,255,255,0.12)"
        },
        dark: {
            toolbarBackground: "#0f1117",
            viewerBackground: "#1a1d24",
            sidebarBackground: "#101316",
            panelBackground: "#11151b",
            accent: "#7fb4ff",
            text: "#edf3ff",
            toolbarText: "#edf3ff",
            buttonBackground: "rgba(255,255,255,0.06)",
            border: "rgba(255,255,255,0.12)"
        }
    };

    const selected = themes[theme] || themes.classic;
    const palette = { ...selected };
    if (flipbookSettings.backgroundColor) {
        palette.viewerBackground = normalizeHexColor(flipbookSettings.backgroundColor, palette.viewerBackground);
    }
    if (flipbookSettings.viewerBackground) {
        palette.viewerBackground = normalizeHexColor(flipbookSettings.viewerBackground, palette.viewerBackground);
    }
    if (flipbookSettings.toolbarColor) {
        palette.toolbarBackground = normalizeHexColor(flipbookSettings.toolbarColor, palette.toolbarBackground);
    }
    if (flipbookSettings.accentColor) {
        palette.accent = normalizeHexColor(flipbookSettings.accentColor, palette.accent);
    }
    return palette;
}

function setBookTitle() {

    if (!elementExists(bookTitle)) {
        return;
    }

    const titleText = flipbookSettings && flipbookSettings.title
        ? flipbookSettings.title
        : (flipbookData && flipbookData.title && flipbookData.title.trim())
            ? flipbookData.title
            : "Flipbook";

    bookTitle.textContent = titleText;
    document.title = titleText;

    if (bookSubtitle) {
        bookSubtitle.textContent = flipbookSettings && flipbookSettings.subtitle ? flipbookSettings.subtitle : "";
        bookSubtitle.classList.toggle("hidden", !flipbookSettings.subtitle);
    }

    if (brandLogo) {
        const logoUrl = flipbookSettings && flipbookSettings.logo ? flipbookSettings.logo : "";
        if (logoUrl) {
            brandLogo.src = logoUrl;
            brandLogo.classList.remove("hidden");
        } else {
            brandLogo.removeAttribute("src");
            brandLogo.classList.add("hidden");
        }
    }

}

function getDefaultSettings() {
    return {
        ...DEFAULT_FLIPBOOK_SETTINGS,
        title: (flipbookData && flipbookData.title) ? flipbookData.title : "",
        backgroundColor: DEFAULT_FLIPBOOK_SETTINGS.backgroundColor,
        viewerBackground: DEFAULT_FLIPBOOK_SETTINGS.viewerBackground,
        toolbarColor: DEFAULT_FLIPBOOK_SETTINGS.toolbarColor,
        accentColor: DEFAULT_FLIPBOOK_SETTINGS.accentColor
    };
}

function sanitizeSettings(settings) {
    if (!settings || typeof settings !== "object") {
        return getDefaultSettings();
    }
    const merged = getDefaultSettings();
    const safeTheme = ["classic", "minimal", "magazine", "dark"].includes(settings.theme) ? settings.theme : merged.theme;
    const safeMode = ["light", "dark"].includes(settings.mode) ? settings.mode : merged.mode;
    merged.theme = safeTheme;
    merged.mode = safeMode;
    merged.backgroundColor = normalizeHexColor(settings.backgroundColor, merged.backgroundColor);
    merged.viewerBackground = normalizeHexColor(settings.viewerBackground, merged.viewerBackground);
    merged.toolbarColor = normalizeHexColor(settings.toolbarColor, merged.toolbarColor);
    merged.accentColor = normalizeHexColor(settings.accentColor, merged.accentColor);
    merged.title = normalizeText(settings.title, merged.title);
    merged.subtitle = normalizeText(settings.subtitle, "");
    merged.companyName = normalizeText(settings.companyName, "");
    merged.showLogo = Boolean(settings.showLogo);
    merged.logo = normalizeText(settings.logo, "");
    merged.backgroundImage = normalizeText(settings.backgroundImage, "");
    merged.showSearch = Boolean(settings.showSearch !== false);
    merged.showThumbnails = Boolean(settings.showThumbnails !== false);
    merged.showZoom = Boolean(settings.showZoom !== false);
    merged.showFullscreen = Boolean(settings.showFullscreen !== false);
    merged.showShare = Boolean(settings.showShare !== false);
    merged.showDownload = Boolean(settings.showDownload !== false);
    merged.pageShadow = Boolean(settings.pageShadow !== false);
    merged.pageTurnSound = Boolean(settings.pageTurnSound);
    merged.toolbarPosition = "top";
    return merged;
}

function updateToolbarVisibility() {
    const toolbarButtons = {
        search: searchButton,
        thumbnails: thumbnailsButton,
        zoom: zoomIn,
        zoomOut,
        fullscreen: fullscreenButton,
        share: shareButton,
        download: downloadButton
    };

    const toggle = (button, allowed) => {
        if (!button) return;
        button.classList.toggle("hidden", !allowed);
    };

    toggle(toolbarButtons.search, flipbookSettings.showSearch !== false);
    toggle(toolbarButtons.thumbnails, flipbookSettings.showThumbnails !== false);
    toggle(toolbarButtons.zoom, flipbookSettings.showZoom !== false);
    toggle(toolbarButtons.zoomOut, flipbookSettings.showZoom !== false);
    toggle(toolbarButtons.fullscreen, flipbookSettings.showFullscreen !== false);
    toggle(toolbarButtons.share, flipbookSettings.showShare !== false);
    toggle(toolbarButtons.download, flipbookSettings.showDownload !== false);

    if (zoomValue) {
        zoomValue.classList.toggle("hidden", flipbookSettings.showZoom === false);
    }
}

function applyViewerSettings() {
    const palette = getThemePalette(flipbookSettings.theme, flipbookSettings.mode);

    const rootStyle = document.body.style;
    rootStyle.background = flipbookSettings.backgroundColor || palette.viewerBackground;
    rootStyle.backgroundImage = flipbookSettings.backgroundImage ? `url("${flipbookSettings.backgroundImage}")` : "none";
    rootStyle.backgroundRepeat = "no-repeat";
    rootStyle.backgroundPosition = "center center";
    rootStyle.backgroundAttachment = "fixed";
    rootStyle.backgroundSize = "cover";

    const toolbar = document.querySelector(".topbar");
    const controls = document.querySelector(".controls");
    const sidebar = document.getElementById("thumbnailSidebar");
    const searchPanelBox = document.getElementById("searchPanel");
    const viewer = document.getElementById("viewer");

    if (toolbar) {
        toolbar.style.background = flipbookSettings.toolbarColor || palette.toolbarBackground;
        toolbar.style.color = palette.toolbarText;
        toolbar.style.borderColor = palette.border;
    }

    if (controls) {
        controls.style.background = flipbookSettings.toolbarColor || palette.toolbarBackground;
        controls.style.borderColor = palette.border;
        controls.style.color = palette.toolbarText;
    }

    if (sidebar) {
        sidebar.style.background = palette.sidebarBackground;
        sidebar.style.borderColor = palette.border;
    }

    if (searchPanelBox) {
        searchPanelBox.style.background = palette.panelBackground;
        searchPanelBox.style.borderColor = palette.border;
        searchPanelBox.style.color = palette.text;
    }

    if (viewer) {
        viewer.style.background = flipbookSettings.viewerBackground || palette.viewerBackground;
    }

    document.body.style.setProperty("--accent-color", flipbookSettings.accentColor || palette.accent);
    document.body.style.setProperty("--toolbar-bg", flipbookSettings.toolbarColor || palette.toolbarBackground);
    document.body.style.setProperty("--viewer-bg", flipbookSettings.viewerBackground || palette.viewerBackground);
    document.body.style.setProperty("--panel-bg", palette.panelBackground);
    document.body.style.setProperty("--sidebar-bg", palette.sidebarBackground);
    document.body.style.setProperty("--text-color", palette.text);
    document.body.style.setProperty("--book-shadow", flipbookSettings.pageShadow ? "0 18px 35px rgba(0, 0, 0, 0.35), 0 35px 80px rgba(0, 0, 0, 0.45)" : "0 8px 22px rgba(0, 0, 0, 0.18)");

    const pageShadowValue = flipbookSettings.pageShadow ? "inset 0 0 0 1px rgba(255,255,255,.7), inset 0 0 18px rgba(0,0,0,0.025)" : "none";
    const pageRule = document.querySelector(".flipbook .page");
    if (pageRule) {
        pageRule.style.boxShadow = pageShadowValue;
    }

    const bookElement = document.getElementById("book");
    if (bookElement) {
        bookElement.style.boxShadow = flipbookSettings.pageShadow ? "0 18px 35px rgba(0, 0, 0, 0.35), 0 35px 80px rgba(0, 0, 0, 0.45)" : "0 8px 22px rgba(0, 0, 0, 0.22)";
    }

    updateToolbarVisibility();
    setBookTitle();

    if (customizeThemeInputs && customizeThemeInputs.length) {
        customizeThemeInputs.forEach((input) => {
            input.checked = input.value === flipbookSettings.theme;
        });
    }

    if (customizeModeInputs && customizeModeInputs.length) {
        customizeModeInputs.forEach((input) => {
            input.checked = input.value === flipbookSettings.mode;
        });
    }

    if (backgroundColorInput) backgroundColorInput.value = flipbookSettings.backgroundColor || "#f3f3f3";
    if (viewerBackgroundInput) viewerBackgroundInput.value = flipbookSettings.viewerBackground || "#f8f8f8";
    if (toolbarColorInput) toolbarColorInput.value = flipbookSettings.toolbarColor || "#ffffff";
    if (accentColorInput) accentColorInput.value = flipbookSettings.accentColor || "#2d3748";
    if (titleInput) titleInput.value = flipbookSettings.title || "";
    if (subtitleInput) subtitleInput.value = flipbookSettings.subtitle || "";
    if (companyNameInput) companyNameInput.value = flipbookSettings.companyName || "";
    if (pageShadowCheckbox) pageShadowCheckbox.checked = Boolean(flipbookSettings.pageShadow);
    if (pageTurnSoundCheckbox) pageTurnSoundCheckbox.checked = Boolean(flipbookSettings.pageTurnSound);
    if (showSearchCheckbox) showSearchCheckbox.checked = Boolean(flipbookSettings.showSearch !== false);
    if (showThumbnailsCheckbox) showThumbnailsCheckbox.checked = Boolean(flipbookSettings.showThumbnails !== false);
    if (showZoomCheckbox) showZoomCheckbox.checked = Boolean(flipbookSettings.showZoom !== false);
    if (showFullscreenCheckbox) showFullscreenCheckbox.checked = Boolean(flipbookSettings.showFullscreen !== false);
    if (showShareCheckbox) showShareCheckbox.checked = Boolean(flipbookSettings.showShare !== false);
    if (showDownloadCheckbox) showDownloadCheckbox.checked = Boolean(flipbookSettings.showDownload !== false);

    if (removeBackgroundCheckbox) removeBackgroundCheckbox.checked = false;
    if (removeLogoCheckbox) removeLogoCheckbox.checked = false;
}

function setCustomizePanelOpen(open) {
    if (!customizePanel) {
        return;
    }
    customizePanel.hidden = !open;
    document.body.classList.toggle("customize-open", open);
    if (customizeButton) {
        customizeButton.setAttribute("aria-expanded", String(open));
    }
    if (open && customizeForm) {
        updateCustomizeFormValues();
    }
}

function updateCustomizeFormValues() {
    if (!customizeForm) {
        return;
    }
    if (titleInput) titleInput.value = flipbookSettings.title || "";
    if (subtitleInput) subtitleInput.value = flipbookSettings.subtitle || "";
    if (companyNameInput) companyNameInput.value = flipbookSettings.companyName || "";
    if (backgroundColorInput) backgroundColorInput.value = flipbookSettings.backgroundColor || "#f3f3f3";
    if (viewerBackgroundInput) viewerBackgroundInput.value = flipbookSettings.viewerBackground || "#f8f8f8";
    if (toolbarColorInput) toolbarColorInput.value = flipbookSettings.toolbarColor || "#ffffff";
    if (accentColorInput) accentColorInput.value = flipbookSettings.accentColor || "#2d3748";
    if (pageShadowCheckbox) pageShadowCheckbox.checked = Boolean(flipbookSettings.pageShadow);
    if (pageTurnSoundCheckbox) pageTurnSoundCheckbox.checked = Boolean(flipbookSettings.pageTurnSound);
    if (showSearchCheckbox) showSearchCheckbox.checked = Boolean(flipbookSettings.showSearch !== false);
    if (showThumbnailsCheckbox) showThumbnailsCheckbox.checked = Boolean(flipbookSettings.showThumbnails !== false);
    if (showZoomCheckbox) showZoomCheckbox.checked = Boolean(flipbookSettings.showZoom !== false);
    if (showFullscreenCheckbox) showFullscreenCheckbox.checked = Boolean(flipbookSettings.showFullscreen !== false);
    if (showShareCheckbox) showShareCheckbox.checked = Boolean(flipbookSettings.showShare !== false);
    if (showDownloadCheckbox) showDownloadCheckbox.checked = Boolean(flipbookSettings.showDownload !== false);
    customizeThemeInputs.forEach((input) => {
        input.checked = input.value === flipbookSettings.theme;
    });
    customizeModeInputs.forEach((input) => {
        input.checked = input.value === flipbookSettings.mode;
    });
}

function collectSettingsFromForm() {
    const removeLogo = removeLogoCheckbox ? removeLogoCheckbox.checked : false;
    const removeBackground = removeBackgroundCheckbox ? removeBackgroundCheckbox.checked : false;

    const formValues = {
        theme: (customizeThemeInputs.find((input) => input.checked) || { value: flipbookSettings.theme }).value,
        mode: (customizeModeInputs.find((input) => input.checked) || { value: flipbookSettings.mode }).value,
        backgroundColor: backgroundColorInput ? backgroundColorInput.value : flipbookSettings.backgroundColor,
        viewerBackground: viewerBackgroundInput ? viewerBackgroundInput.value : flipbookSettings.viewerBackground,
        toolbarColor: toolbarColorInput ? toolbarColorInput.value : flipbookSettings.toolbarColor,
        accentColor: accentColorInput ? accentColorInput.value : flipbookSettings.accentColor,
        title: titleInput ? titleInput.value : flipbookSettings.title,
        subtitle: subtitleInput ? subtitleInput.value : flipbookSettings.subtitle,
        companyName: companyNameInput ? companyNameInput.value : flipbookSettings.companyName,
        pageShadow: pageShadowCheckbox ? pageShadowCheckbox.checked : Boolean(flipbookSettings.pageShadow),
        pageTurnSound: pageTurnSoundCheckbox ? pageTurnSoundCheckbox.checked : Boolean(flipbookSettings.pageTurnSound),
        showSearch: showSearchCheckbox ? showSearchCheckbox.checked : Boolean(flipbookSettings.showSearch !== false),
        showThumbnails: showThumbnailsCheckbox ? showThumbnailsCheckbox.checked : Boolean(flipbookSettings.showThumbnails !== false),
        showZoom: showZoomCheckbox ? showZoomCheckbox.checked : Boolean(flipbookSettings.showZoom !== false),
        showFullscreen: showFullscreenCheckbox ? showFullscreenCheckbox.checked : Boolean(flipbookSettings.showFullscreen !== false),
        showShare: showShareCheckbox ? showShareCheckbox.checked : Boolean(flipbookSettings.showShare !== false),
        showDownload: showDownloadCheckbox ? showDownloadCheckbox.checked : Boolean(flipbookSettings.showDownload !== false),
        logo: removeLogo ? "" : (flipbookSettings.logo || ""),
        backgroundImage: removeBackground ? "" : (flipbookSettings.backgroundImage || ""),
        removeLogo,
        removeBackground,
        toolbarPosition: "top"
    };

    return sanitizeSettings(formValues);
}

function readCustomizationFile(file) {
    return new Promise(function (resolve, reject) {
        const reader = new FileReader();
        reader.addEventListener("load", function () {
            if (typeof reader.result === "string") {
                resolve(reader.result);
            } else {
                reject(new Error("The selected image could not be read."));
            }
        });
        reader.addEventListener("error", function () {
            reject(reader.error || new Error("The selected image could not be read."));
        });
        reader.readAsDataURL(file);
    });
}

async function saveCustomizationSettings() {
    const settingsToSave = collectSettingsFromForm();
    if (!jobId) {
        try {
            if (logoInput && logoInput.files && logoInput.files[0]) {
                settingsToSave.logo = await readCustomizationFile(logoInput.files[0]);
                settingsToSave.showLogo = true;
            } else if (removeLogoCheckbox && removeLogoCheckbox.checked) {
                settingsToSave.logo = "";
                settingsToSave.showLogo = false;
            }
            if (backgroundImageInput && backgroundImageInput.files && backgroundImageInput.files[0]) {
                settingsToSave.backgroundImage = await readCustomizationFile(backgroundImageInput.files[0]);
            } else if (removeBackgroundCheckbox && removeBackgroundCheckbox.checked) {
                settingsToSave.backgroundImage = "";
            }

            const localSettingsKey = `flipbook-settings-${flipbookData.job_id || "standalone"}`;
            localStorage.setItem(localSettingsKey, JSON.stringify(settingsToSave));
            flipbookSettings = sanitizeSettings(settingsToSave);
            applyViewerSettings();
            if (logoInput) logoInput.value = "";
            if (backgroundImageInput) backgroundImageInput.value = "";
            if (removeLogoCheckbox) removeLogoCheckbox.checked = false;
            if (removeBackgroundCheckbox) removeBackgroundCheckbox.checked = false;
            if (saveSettingsButton) {
                saveSettingsButton.textContent = "Saved";
                window.setTimeout(function () {
                    if (saveSettingsButton) saveSettingsButton.textContent = "Save";
                }, 1200);
            }
        } catch (error) {
            console.error("Could not save standalone flipbook customization settings:", error);
            window.alert(error.message || "Could not save the flipbook settings in this browser.");
        }
        return;
    }

    const formData = new FormData();
    formData.append("settings", JSON.stringify({
        ...settingsToSave,
        removeLogo: removeLogoCheckbox ? removeLogoCheckbox.checked : false,
        removeBackground: removeBackgroundCheckbox ? removeBackgroundCheckbox.checked : false,
        showLogo: removeLogoCheckbox ? !removeLogoCheckbox.checked : Boolean(settingsToSave.showLogo),
        backgroundImage: removeBackgroundCheckbox && removeBackgroundCheckbox.checked ? "" : (settingsToSave.backgroundImage || "")
    }));

    if (logoInput && logoInput.files && logoInput.files[0]) {
        formData.append("logo", logoInput.files[0]);
    }

    if (backgroundImageInput && backgroundImageInput.files && backgroundImageInput.files[0]) {
        formData.append("background", backgroundImageInput.files[0]);
    }

    try {
        const response = await fetch(`/api/job/${encodeURIComponent(jobId)}/settings`, {
            method: "POST",
            body: formData
        });

        const data = await response.json();
        if (!response.ok || !data.success) {
            throw new Error(data.message || "Could not save these settings.");
        }

        flipbookSettings = sanitizeSettings({ ...data.settings, title: data.settings.title || flipbookData.title || "Flipbook" });
        applyViewerSettings();
        if (logoInput) logoInput.value = "";
        if (backgroundImageInput) backgroundImageInput.value = "";
        if (removeLogoCheckbox) removeLogoCheckbox.checked = false;
        if (removeBackgroundCheckbox) removeBackgroundCheckbox.checked = false;

        if (saveSettingsButton) {
            saveSettingsButton.textContent = "Saved";
            window.setTimeout(() => {
                if (saveSettingsButton) {
                    saveSettingsButton.textContent = "Save";
                }
            }, 1200);
        }
    } catch (error) {
        console.error("Could not save flipbook customization settings:", error);
        window.alert(error.message || "Could not save the flipbook settings.");
    }
}

async function resetCustomizationSettings() {
    flipbookSettings = getDefaultSettings();
    applyViewerSettings();
    if (!jobId) {
        try {
            localStorage.removeItem(`flipbook-settings-${flipbookData.job_id || "standalone"}`);
            if (saveSettingsButton) saveSettingsButton.textContent = "Reset";
        } catch (error) {
            console.error("Could not reset standalone flipbook customization settings:", error);
            window.alert("Could not reset the flipbook settings in this browser.");
        }
        return;
    }
    await saveCustomizationSettings();
}

async function loadJobSettings() {
    if (!jobId) {
        const embeddedSettings = flipbookData && flipbookData.settings ? flipbookData.settings : {};
        let savedSettings = {};
        try {
            const storedSettings = localStorage.getItem(`flipbook-settings-${flipbookData.job_id || "standalone"}`);
            if (storedSettings) savedSettings = JSON.parse(storedSettings);
        } catch (error) {
            console.warn("Could not load saved standalone flipbook settings:", error);
        }
        flipbookSettings = sanitizeSettings({
            ...embeddedSettings,
            ...savedSettings,
            title: savedSettings.title || embeddedSettings.title || (flipbookData && flipbookData.title) || "Flipbook"
        });
        applyViewerSettings();
        return;
    }

    try {
        const response = await fetch(`/api/job/${encodeURIComponent(jobId)}/settings`);
        if (!response.ok) {
            return;
        }
        const data = await response.json();
        if (!data.success || !data.settings) {
            return;
        }
        flipbookSettings = sanitizeSettings({
            ...data.settings,
            title: data.settings.title || (flipbookData && flipbookData.title) || "Flipbook"
        });
        applyViewerSettings();
    } catch (error) {
        console.warn("Could not load saved customization settings:", error);
    }
}


// ============================================================
// UPDATE PAGE COUNTER
// ============================================================

function updatePageCounter(page) {

    currentPage =
        Math.max(
            1,
            Math.min(
                page,
                totalPages
            )
        );


    if (elementExists(currentPageElement)) {

        let displayedPage = currentPage;

        if (isReady && window.jQuery && jQuery.fn.turn) {
            try {
                const visiblePages = jQuery(book).turn("view").filter(function (pageNumber) {
                    return pageNumber >= 1 && pageNumber <= totalPages;
                });
                if (visiblePages.length > 1) {
                    displayedPage = `${visiblePages[0]}-${visiblePages[visiblePages.length - 1]}`;
                }
            } catch (error) {
                displayedPage = currentPage;
            }
        }

        currentPageElement.textContent =
            displayedPage;

    }


    if (elementExists(totalPagesElement)) {

        totalPagesElement.textContent =
            totalPages;

    }


    updateNavigationButtons();
    updateActiveThumbnail();


    // --------------------------------------------------------
    // IMPORTANT
    // --------------------------------------------------------
    //
    // Whenever the user changes page,
    // begin loading nearby high-resolution pages.
    //
    // --------------------------------------------------------

    progressivelyLoadNearbyPages(
        currentPage
    );

}


function createThumbnails() {
    if (!thumbnailList) return;
    const fragment = document.createDocumentFragment();

    pages.forEach(function (imageURL, index) {
        const pageNumber = index + 1;
        const button = document.createElement("button");
        button.type = "button";
        button.className = "thumbnail-item";
        button.dataset.page = pageNumber;
        button.setAttribute("aria-label", `Go to page ${pageNumber}`);

        const image = document.createElement("img");
        image.src = imageURL;
        image.alt = "";
        image.loading = "lazy";
        image.decoding = "async";
        image.draggable = false;
        const dimensions = Array.isArray(flipbookData && flipbookData.page_dimensions)
            ? flipbookData.page_dimensions.find(function (page) {
                return Number(page.page) === pageNumber;
            })
            : null;
        if (dimensions && Number(dimensions.width) > 0 && Number(dimensions.height) > 0) {
            image.style.aspectRatio = `${dimensions.width} / ${dimensions.height}`;
        }
        image.onerror = function () {
            image.classList.add("thumbnail-missing");
            image.removeAttribute("src");
        };

        const label = document.createElement("span");
        label.textContent = String(pageNumber);
        button.append(image, label);
        button.addEventListener("click", function () {
            turnAfterLoading(pageNumber, "page", pageNumber);
            if (window.matchMedia("(max-width: 900px)").matches) {
                setThumbnailSidebar(false);
            }
        });
        fragment.appendChild(button);
    });

    thumbnailList.replaceChildren(fragment);
    updateActiveThumbnail();
}


function updateActiveThumbnail() {
    if (!thumbnailList) return;
    let visiblePages = [currentPage];
    if (isReady && window.jQuery && jQuery.fn.turn) {
        try {
            visiblePages = jQuery(book).turn("view").filter(function (pageNumber) {
                return pageNumber >= 1 && pageNumber <= totalPages;
            });
        } catch (error) {
            visiblePages = [currentPage];
        }
    }
    thumbnailList.querySelectorAll(".thumbnail-item").forEach(function (item) {
        const pageNumber = Number(item.dataset.page);
        const active = visiblePages.includes(pageNumber);
        item.classList.toggle("active", active);
        item.setAttribute("aria-current", active ? "page" : "false");
        if (pageNumber === currentPage && active && item.closest(".thumbnail-sidebar")) {
            item.scrollIntoView({ block: "nearest" });
        }
    });
}


function setThumbnailSidebar(open) {
    document.body.classList.toggle("thumbnails-open", open);
    if (thumbnailSidebar) thumbnailSidebar.setAttribute("aria-hidden", String(!open));
    if (thumbnailsButton) {
        thumbnailsButton.setAttribute("aria-expanded", String(open));
        thumbnailsButton.title = open ? "Hide page thumbnails" : "Show page thumbnails";
        thumbnailsButton.setAttribute("aria-label", thumbnailsButton.title);
    }
    if (window.matchMedia("(max-width: 900px)").matches) {
        return;
    }
    window.setTimeout(function () {
        window.dispatchEvent(new Event("resize"));
    }, 270);
}


function getThumbnailSidebarWidthLimits() {
    if (window.matchMedia("(max-width: 900px)").matches) {
        const min = Math.min(220, window.innerWidth * 0.55);
        return {
            min,
            max: Math.max(min, window.innerWidth * 0.84)
        };
    }
    return {
        min: 220,
        max: Math.max(220, Math.min(560, window.innerWidth - 320))
    };
}


function updateThumbnailSidebarResizeRange() {
    if (!thumbnailSidebarResizeHandle) return;
    const limits = getThumbnailSidebarWidthLimits();
    thumbnailSidebarResizeHandle.setAttribute("aria-valuemin", String(Math.round(limits.min)));
    thumbnailSidebarResizeHandle.setAttribute("aria-valuemax", String(Math.round(limits.max)));
}


let thumbnailSidebarResizeEventScheduled = false;


function setThumbnailSidebarWidth(width) {
    if (!thumbnailSidebar) return;
    const limits = getThumbnailSidebarWidthLimits();
    const boundedWidth = Math.round(Math.min(limits.max, Math.max(limits.min, width)));
    document.body.style.setProperty("--thumbnail-sidebar-width", `${boundedWidth}px`);
    thumbnailSidebar.style.width = `${boundedWidth}px`;
    if (thumbnailSidebarResizeHandle) {
        updateThumbnailSidebarResizeRange();
        thumbnailSidebarResizeHandle.setAttribute("aria-valuenow", String(boundedWidth));
    }
    if (!thumbnailSidebarResizeEventScheduled) {
        thumbnailSidebarResizeEventScheduled = true;
        window.requestAnimationFrame(function () {
            thumbnailSidebarResizeEventScheduled = false;
            window.dispatchEvent(new Event("resize"));
        });
    }
}

updateThumbnailSidebarResizeRange();
window.addEventListener("resize", updateThumbnailSidebarResizeRange);


if (thumbnailSidebarResizeHandle && thumbnailSidebar) {
    let activePointerId = null;

    thumbnailSidebarResizeHandle.addEventListener("pointerdown", function (event) {
        if (!document.body.classList.contains("thumbnails-open") || event.button !== 0) return;
        event.preventDefault();
        activePointerId = event.pointerId;
        thumbnailSidebarResizeHandle.setPointerCapture(activePointerId);
        document.body.classList.add("thumbnail-sidebar-resizing");
    });

    thumbnailSidebarResizeHandle.addEventListener("pointermove", function (event) {
        if (event.pointerId !== activePointerId) return;
        const width = event.clientX - thumbnailSidebar.getBoundingClientRect().left;
        setThumbnailSidebarWidth(width);
    });

    function endThumbnailSidebarResize(event) {
        if (event.pointerId !== activePointerId) return;
        activePointerId = null;
        document.body.classList.remove("thumbnail-sidebar-resizing");
        if (thumbnailSidebarResizeHandle.hasPointerCapture(event.pointerId)) {
            thumbnailSidebarResizeHandle.releasePointerCapture(event.pointerId);
        }
    }

    thumbnailSidebarResizeHandle.addEventListener("pointerup", endThumbnailSidebarResize);
    thumbnailSidebarResizeHandle.addEventListener("pointercancel", endThumbnailSidebarResize);
    thumbnailSidebarResizeHandle.addEventListener("lostpointercapture", function () {
        activePointerId = null;
        document.body.classList.remove("thumbnail-sidebar-resizing");
    });

    thumbnailSidebarResizeHandle.addEventListener("keydown", function (event) {
        if (!document.body.classList.contains("thumbnails-open")) return;
        const limits = getThumbnailSidebarWidthLimits();
        const currentWidth = thumbnailSidebar.getBoundingClientRect().width;
        let nextWidth;
        if (event.key === "ArrowLeft") {
            nextWidth = currentWidth - (event.shiftKey ? 40 : 20);
        } else if (event.key === "ArrowRight") {
            nextWidth = currentWidth + (event.shiftKey ? 40 : 20);
        } else if (event.key === "Home") {
            nextWidth = limits.min;
        } else if (event.key === "End") {
            nextWidth = limits.max;
        } else {
            return;
        }
        event.preventDefault();
        setThumbnailSidebarWidth(nextWidth);
    });
}


async function loadSearchIndex() {
    const embeddedSearchIndex = flipbookData && flipbookData.search_index;
    if (Array.isArray(embeddedSearchIndex)) {
        searchablePages = embeddedSearchIndex;
        searchIndexError = "";
        return;
    }
    if (embeddedSearchIndex && Array.isArray(embeddedSearchIndex.pages)) {
        searchablePages = embeddedSearchIndex.pages;
        searchIndexError = embeddedSearchIndex.ocr_error || "";
        return;
    }
    const indexUrl = jobId
        ? `/api/job/${encodeURIComponent(jobId)}/search-index`
        : (Array.isArray(localPageList) ? "search-index.json" : null);
    if (!indexUrl) return;

    try {
        const response = await fetch(indexUrl);
        if (!response.ok) {
            throw new Error(`Search data could not be loaded (HTTP ${response.status}).`);
        }
        const data = await response.json();
        searchablePages = Array.isArray(data.pages) ? data.pages : [];
        searchIndexError = data.ocr_error || "";
    } catch (error) {
        console.warn("PDF text search is unavailable:", error);
        searchablePages = [];
        searchIndexError = error.message || "Search data could not be loaded.";
    }
}


function runSearch() {
    const term = searchInput ? searchInput.value.trim() : "";
    searchMatches = [];
    activeSearchResult = -1;
    if (searchResults) searchResults.replaceChildren();

    if (!term) {
        if (searchSummary) searchSummary.textContent = "Enter a word or phrase.";
        updateSearchResultControls();
        return;
    }
    if (!searchablePages.some(page => String(page.text || "").trim())) {
        if (searchSummary) {
            searchSummary.textContent = searchIndexError
                ? `Search is unavailable: ${searchIndexError}`
                : "No searchable text could be recognized in this PDF. Scanned pages may need clearer images.";
        }
        updateSearchResultControls();
        return;
    }

    const needle = term.toLocaleLowerCase();
    searchablePages.forEach(function (pageData, index) {
        const text = String(pageData.text || "");
        const normalizedText = text.toLocaleLowerCase();
        let offset = 0;
        let count = 0;
        let firstIndex = -1;
        while ((offset = normalizedText.indexOf(needle, offset)) !== -1) {
            if (firstIndex === -1) firstIndex = offset;
            count++;
            offset += Math.max(needle.length, 1);
        }
        if (!count) return;

        const pageNumber = Number(pageData.page) || index + 1;
        const start = Math.max(0, firstIndex - 45);
        const end = Math.min(text.length, firstIndex + term.length + 70);
        const excerpt = `${start > 0 ? "..." : ""}${text.slice(start, end).replace(/\s+/g, " ").trim()}${end < text.length ? "..." : ""}`;
        searchMatches.push({ page: pageNumber, count, excerpt });

        const item = document.createElement("li");
        const resultButton = document.createElement("button");
        resultButton.type = "button";
        resultButton.className = "search-result";
        const pageLabel = document.createElement("strong");
        pageLabel.textContent = `Page ${pageNumber}`;
        const matchCount = document.createElement("span");
        matchCount.textContent = `${count} ${count === 1 ? "match" : "matches"}`;
        const snippet = document.createElement("span");
        snippet.className = "search-excerpt";
        snippet.textContent = excerpt;
        resultButton.append(pageLabel, matchCount, snippet);
        resultButton.addEventListener("click", function () {
            activeSearchResult = searchMatches.findIndex(match => match.page === pageNumber);
            navigateToSearchResult(activeSearchResult);
        });
        item.appendChild(resultButton);
        searchResults.appendChild(item);
    });

    const totalMatches = searchMatches.reduce((total, match) => total + match.count, 0);
    if (searchSummary) {
        searchSummary.textContent = searchMatches.length
            ? `${totalMatches} ${totalMatches === 1 ? "match" : "matches"} on ${searchMatches.length} ${searchMatches.length === 1 ? "page" : "pages"}`
            : "No results found.";
    }
    updateSearchResultControls();
}


function updateSearchResultControls() {
    const disabled = searchMatches.length < 2;
    if (previousResultButton) previousResultButton.disabled = disabled;
    if (nextResultButton) nextResultButton.disabled = disabled;
}


function navigateToSearchResult(index) {
    if (index < 0 || index >= searchMatches.length) return;
    activeSearchResult = index;
    turnAfterLoading(searchMatches[index].page, "page", searchMatches[index].page);
    searchResults.querySelectorAll(".search-result").forEach(function (button, buttonIndex) {
        button.classList.toggle("active", buttonIndex === index);
    });
    updateSearchResultControls();
}


function moveSearchResult(direction) {
    if (!searchMatches.length) return;
    const nextIndex = activeSearchResult < 0
        ? (direction > 0 ? 0 : searchMatches.length - 1)
        : (activeSearchResult + direction + searchMatches.length) % searchMatches.length;
    navigateToSearchResult(nextIndex);
}


if (thumbnailsButton) {
    thumbnailsButton.addEventListener("click", function () {
        setThumbnailSidebar(!document.body.classList.contains("thumbnails-open"));
    });
}

if (closeThumbnailsButton) {
    closeThumbnailsButton.addEventListener("click", function () {
        setThumbnailSidebar(false);
    });
}

if (sidebarBackdrop) {
    sidebarBackdrop.addEventListener("click", function () {
        setThumbnailSidebar(false);
    });
}

if (searchButton && searchPanel) {
    searchButton.addEventListener("click", function () {
        const open = searchPanel.hidden;
        if (open && window.matchMedia("(max-width: 900px)").matches) {
            setThumbnailSidebar(false);
        }
        searchPanel.hidden = !open;
        searchButton.setAttribute("aria-expanded", String(open));
        if (open && searchInput) searchInput.focus();
    });
}

if (searchForm) {
    searchForm.addEventListener("submit", function (event) {
        event.preventDefault();
        if (searchSummary) searchSummary.textContent = "Searching PDF text...";
        loadSearchIndex().then(runSearch);
    });
}

if (previousResultButton) {
    previousResultButton.addEventListener("click", function () {
        moveSearchResult(-1);
    });
}

if (nextResultButton) {
    nextResultButton.addEventListener("click", function () {
        moveSearchResult(1);
    });
}

if (shareButton) {
    shareButton.addEventListener("click", async function () {
        const url = window.location.href;
        try {
            await navigator.clipboard.writeText(url);
            shareButton.title = "Share link copied";
            window.setTimeout(function () { shareButton.title = "Copy share link"; }, 1800);
        } catch (error) {
            window.prompt("Copy this flipbook link:", url);
        }
    });
}

if (customizeButton) {
    customizeButton.addEventListener("click", function () {
        setCustomizePanelOpen(customizePanel ? customizePanel.hidden : false);
    });
}

if (closeCustomizeButton) {
    closeCustomizeButton.addEventListener("click", function () {
        setCustomizePanelOpen(false);
    });
}

if (customizeBackdrop) {
    customizeBackdrop.addEventListener("click", function () {
        setCustomizePanelOpen(false);
    });
}

if (customizeForm) {
    customizeForm.addEventListener("submit", function (event) {
        event.preventDefault();
        const previewSettings = collectSettingsFromForm();
        flipbookSettings = previewSettings;
        applyViewerSettings();
        saveCustomizationSettings();
    });

    customizeForm.addEventListener("input", function () {
        const previewSettings = collectSettingsFromForm();
        flipbookSettings = previewSettings;
        applyViewerSettings();
    });

    customizeForm.addEventListener("change", function () {
        const previewSettings = collectSettingsFromForm();
        flipbookSettings = previewSettings;
        applyViewerSettings();
    });
}

if (resetSettingsButton) {
    resetSettingsButton.addEventListener("click", function () {
        resetCustomizationSettings();
    });
}

if (saveSettingsButton) {
    saveSettingsButton.addEventListener("click", function () {
        saveCustomizationSettings();
    });
}


// ============================================================
// UPDATE NAVIGATION BUTTONS
// ============================================================

function updateNavigationButtons() {

    const atBeginning =
        currentPage <= 1;


    const atEnd =
        currentPage >= totalPages;


    if (elementExists(previousButton)) {

        previousButton.disabled =
            atBeginning;

    }


    if (elementExists(previousBottom)) {

        previousBottom.disabled =
            atBeginning;

    }


    if (elementExists(firstButton)) {

        firstButton.disabled =
            atBeginning;

    }


    if (elementExists(nextButton)) {

        nextButton.disabled =
            atEnd;

    }


    if (elementExists(nextBottom)) {

        nextBottom.disabled =
            atEnd;

    }


    if (elementExists(lastButton)) {

        lastButton.disabled =
            atEnd;

    }

}


// ============================================================
// CREATE PAGE
// ============================================================

function createPage(
    imageURL,
    pageNumber
) {

    const page =
        document.createElement(
            "div"
        );


    page.className =
        "page";


    page.dataset.page =
        pageNumber;


    // --------------------------------------------------------
    // Create image
    // --------------------------------------------------------

    const image =
        document.createElement(
            "img"
        );


    // --------------------------------------------------------
    // IMPORTANT
    // --------------------------------------------------------
    //
    // We do NOT immediately load every image.
    //
    // The actual high-resolution URL is stored
    // inside data-src.
    //
    // --------------------------------------------------------

    image.dataset.src =
        imageURL;


    image.alt =
        `PDF Page ${pageNumber}`;


    image.draggable =
        false;


    image.decoding =
        "async";


    image.loading =
        "eager";


    image.className =
        "page-image";


    // --------------------------------------------------------
    // Placeholder
    // --------------------------------------------------------

    image.style.background =
        "#ffffff";


    page.appendChild(
        image
    );


    return page;

}


// ============================================================
// CREATE ALL PAGE ELEMENTS
// ============================================================

function createAllPages() {

    book.innerHTML = "";
    pageElements.clear();


    pages.forEach(
        function (
            imageURL,
            index
        ) {

            const page =
                createPage(
                    imageURL,
                    index + 1
                );


            pageElements.set(index + 1, page);

            book.appendChild(
                page
            );

        }
    );


    // --------------------------------------------------------
    // Turn.js works best with an even number of pages
    // --------------------------------------------------------

    if (
        pages.length % 2 !== 0
    ) {

        const blankPage =
            document.createElement(
                "div"
            );


        blankPage.className =
            "page blank-page";


        blankPage.innerHTML =
            `
            <div class="blank-page-content">
            </div>
            `;


        book.appendChild(
            blankPage
        );

    }

}


// ============================================================
// LOAD ONE HIGH-RESOLUTION PAGE
// ============================================================

function loadPageImage(pageNumber) {

    return new Promise(
        function (resolve) {

            // ------------------------------------------------
            // Invalid page
            // ------------------------------------------------

            if (
                pageNumber < 1 ||
                pageNumber > totalPages
            ) {

                resolve(false);

                return;

            }


            // ------------------------------------------------
            // Already loaded
            // ------------------------------------------------

            if (
                loadedPages.has(
                    pageNumber
                )
            ) {

                resolve(true);

                return;

            }


            // ------------------------------------------------
            // Already loading
            // ------------------------------------------------

            if (loadingPages.has(pageNumber)) {
                resolve(false);
                return;
            }


            loadingPages.add(
                pageNumber
            );


            const pageElement =
                book.querySelector(`.page[data-page="${pageNumber}"]`) ||
                pageElements.get(pageNumber);


            if (!pageElement) {

                loadingPages.delete(
                    pageNumber
                );

                resolve(false);

                return;

            }


            const image =
                pageElement.querySelector(
                    "img"
                );


            if (!image) {

                loadingPages.delete(
                    pageNumber
                );

                resolve(false);

                return;

            }


            const source =
                image.dataset.src;


            if (!source) {

                loadingPages.delete(
                    pageNumber
                );

                resolve(false);

                return;

            }


            // ------------------------------------------------
            // Create a real image object
            //
            // The browser downloads the original
            // 300-DPI WebP image here.
            // ------------------------------------------------

            const highResolutionImage =
                new Image();


            highResolutionImage.decoding =
                "async";

            highResolutionImage.loading =
                "eager";

            if (
                typeof highResolutionImage.fetchPriority !== "undefined"
            ) {

                highResolutionImage.fetchPriority =
                    "high";

            }


            highResolutionImage.onload =
                function () {

                    // ----------------------------------------
                    // Put the downloaded image into
                    // the actual Turn.js page.
                    // ----------------------------------------

                    image.src =
                        source;


                    image.classList.add(
                        "loaded"
                    );


                    loadedPages.add(
                        pageNumber
                    );


                    loadingPages.delete(
                        pageNumber
                    );


                    resolve(true);

                };


            highResolutionImage.onerror =
                function () {

                    console.warn(
                        "Could not load page:",
                        pageNumber,
                        source
                    );


                    loadingPages.delete(
                        pageNumber
                    );


                    resolve(false);

                };


            // ------------------------------------------------
            // Start high-resolution download
            // ------------------------------------------------

            highResolutionImage.src =
                source;

        }
    );

}


async function ensurePageLoaded(pageNumber) {

    if (loadedPages.has(pageNumber)) {
        return true;
    }

    if (!loadingPages.has(pageNumber)) {
        loadPageImage(pageNumber);
    }

    while (loadingPages.has(pageNumber)) {
        await new Promise(
            function (resolve) {
                setTimeout(resolve, 25);
            }
        );
    }

    return loadedPages.has(pageNumber);

}


// ============================================================
// LOAD INITIAL PAGES
// ============================================================
//
// Only the first few pages are loaded before
// Turn.js starts.
//
// This is the biggest speed improvement.
//

async function loadInitialPages() {

    const numberToLoad =
        Math.min(
            INITIAL_PAGES_TO_LOAD,
            totalPages
        );

    const pageNumbers =
        Array.from(
            { length: numberToLoad },
            (_, index) => index + 1
        );


    console.log(
        `Loading first ${numberToLoad} pages in parallel...`
    );


    await Promise.all(
        pageNumbers.map(
            pageNumber =>
                loadPageImage(
                    pageNumber
                )
        )
    );


    console.log(
        "Initial pages ready."
    );

}


// ============================================================
// PROGRESSIVE PAGE LOADING
// ============================================================
//
// Loads pages around the current page.
//
// Example:
// User is on page 10.
//
// Loads:
//
// 8
// 9
// 10
// 11
// 12
//
// This means pages become ready before the user
// reaches them.
//

async function progressivelyLoadNearbyPages(
    centerPage
) {

    const pageNumbers = [];


    // --------------------------------------------------------
    // Current page
    // --------------------------------------------------------

    pageNumbers.push(
        centerPage
    );


    // --------------------------------------------------------
    // Pages around current page
    // --------------------------------------------------------

    for (
        let offset = 1;
        offset <= NEARBY_PAGES_TO_LOAD;
        offset++
    ) {

        const before =
            centerPage - offset;


        const after =
            centerPage + offset;


        if (
            before >= 1
        ) {

            pageNumbers.push(
                before
            );

        }


        if (
            after <= totalPages
        ) {

            pageNumbers.push(
                after
            );

        }

    }


    // --------------------------------------------------------
    // Remove duplicates
    // --------------------------------------------------------

    const uniquePages =
        [...new Set(
            pageNumbers
        )];


    // --------------------------------------------------------
    // Load only a limited number at once
    // --------------------------------------------------------

    let index = 0;


    async function worker() {

        while (
            index <
            uniquePages.length
        ) {

            const pageNumber =
                uniquePages[index];


            index++;


            await loadPageImage(
                pageNumber
            );

        }

    }


    const workers = [];


    const workerCount =
        Math.min(
            MAX_CONCURRENT_LOADS,
            uniquePages.length
        );


    for (
        let i = 0;
        i < workerCount;
        i++
    ) {

        workers.push(
            worker()
        );

    }


    await Promise.all(
        workers
    );

}


// ============================================================
// CALCULATE BOOK SIZE
// ============================================================

function calculateBookSize() {

    const viewer =
        document.getElementById(
            "viewer"
        );


    if (!viewer) {

        const fallbackAspectRatio = getBookAspectRatio();
        const fallbackPageWidth = 700;

        return {

            width: fallbackPageWidth * 2,

            height: Math.floor(fallbackPageWidth / fallbackAspectRatio),

            pageWidth: fallbackPageWidth,

            pageHeight: Math.floor(fallbackPageWidth / fallbackAspectRatio)

        };

    }


    const availableWidth =
        viewer.clientWidth;


    const availableHeight =
        viewer.clientHeight;


    // --------------------------------------------------------
    const aspectRatio = getBookAspectRatio();

    let pageWidth =
        Math.min(
            700,
            Math.floor(
                availableWidth * 0.46
            )
        );


    // --------------------------------------------------------
    let pageHeight =
        Math.floor(
            pageWidth / aspectRatio
        );


    // --------------------------------------------------------
    // Limit by available height
    // --------------------------------------------------------

    const maxHeight =
        Math.floor(
            availableHeight * 0.92
        );


    if (
        pageHeight >
        maxHeight
    ) {

        pageHeight =
            maxHeight;


        pageWidth =
            Math.floor(
                pageHeight * aspectRatio
            );

    }


    pageWidth = Math.max(1, pageWidth);
    pageHeight = Math.max(1, Math.floor(pageWidth / aspectRatio));


    return {

        width:
            pageWidth * 2,

        height:
            pageHeight,

        pageWidth:
            pageWidth,

        pageHeight:
            pageHeight

    };

}


function getBookAspectRatio() {

    const aspectRatio = Number(
        flipbookData && flipbookData.aspect_ratio
    );

    if (Number.isFinite(aspectRatio) && aspectRatio > 0) {
        return aspectRatio;
    }

    return 1 / 1.414;

}


// ============================================================
// INITIALIZE TURN.JS
// ============================================================

function initializeTurnJS() {

    // --------------------------------------------------------
    // Check jQuery
    // --------------------------------------------------------

    if (
        !window.jQuery
    ) {

        showError(
            "jQuery could not be loaded."
        );

        return;

    }


    // --------------------------------------------------------
    // Check Turn.js
    // --------------------------------------------------------

    if (
        !jQuery.fn.turn
    ) {

        showError(
            "Turn.js could not be loaded."
        );

        return;

    }


    // --------------------------------------------------------
    // Check pages
    // --------------------------------------------------------

    if (
        totalPages === 0
    ) {

        showError(
            "This PDF does not contain any pages."
        );

        return;

    }


    const size =
        calculateBookSize();


    try {

        $(book).turn({

            width:
                size.width,

            height:
                size.height,

            display:
                "double",

            autoCenter:
                true,

            duration:
                1100,

            acceleration:
                false,

            gradients:
                true,

            elevation:
                70,

            pages:
                book.children.length,

            direction:
                "ltr",


            when: {

                // ------------------------------------------------
                // PAGE TURNING
                // ------------------------------------------------

                turning:
                    function (
                        event,
                        page
                    ) {

                        isPageTurning = true;

                        const visiblePage =
                            Math.min(
                                page,
                                totalPages
                            );

                        if (visiblePage !== currentPage) {
                            schedulePageTurnSound();
                        }


                        updatePageCounter(
                            visiblePage
                        );


                        // ----------------------------------------
                        // Start loading the new page immediately.
                        // ----------------------------------------

                        loadPageImage(
                            visiblePage
                        );


                        // ----------------------------------------
                        // Also preload nearby pages.
                        // ----------------------------------------

                        progressivelyLoadNearbyPages(
                            visiblePage
                        );

                    },


                // ------------------------------------------------
                // PAGE TURNED
                // ------------------------------------------------

                turned:
                    function (
                        event,
                        page
                    ) {

                        isPageTurning = false;

                        const visiblePage =
                            Math.min(
                                page,
                                totalPages
                            );

                        updatePageCounter(
                            visiblePage
                        );


                        // ----------------------------------------
                        // Continue background loading.
                        // ----------------------------------------

                        progressivelyLoadNearbyPages(
                            visiblePage
                        );

                    }

            }

        });


        isReady =
            true;


        updatePageCounter(
            1
        );

        createThumbnails();


        updateZoom();


        hideLoading();


        // ----------------------------------------------------
        // Start background loading of remaining pages.
        // ----------------------------------------------------

        progressivelyLoadNearbyPages(
            1
        );


        progressivelyLoadAllPagesInBackground();


    } catch (error) {

        console.error(
            "Turn.js initialization error:",
            error
        );


        showError(
            "Could not initialize the flipbook."
        );

    }

}


// ============================================================
// BACKGROUND LOAD ALL PAGES
// ============================================================
//
// This DOES NOT block the flipbook.
//
// The viewer is already visible.
//
// Remaining pages are loaded gradually in the background.
//

async function progressivelyLoadAllPagesInBackground() {

    console.log(
        "Background page loading started."
    );


    const remainingPages = [];


    for (
        let pageNumber = 1;
        pageNumber <= totalPages;
        pageNumber++
    ) {

        if (
            !loadedPages.has(
                pageNumber
            )
        ) {

            remainingPages.push(
                pageNumber
            );

        }

    }


    let index = 0;


    async function worker() {

        while (
            index <
            remainingPages.length
        ) {

            const pageNumber =
                remainingPages[index];


            index++;


            await loadPageImage(
                pageNumber
            );

        }

    }


    const workers = [];


    const workerCount =
        Math.min(
            MAX_CONCURRENT_LOADS,
            remainingPages.length
        );


    for (
        let i = 0;
        i < workerCount;
        i++
    ) {

        workers.push(
            worker()
        );

    }


    await Promise.all(
        workers
    );


    console.log(
        "All high-resolution pages loaded."
    );

}


// ============================================================
// HIDE LOADING SCREEN
// ============================================================

function hideLoading() {

    if (!loading) {
        return;
    }


    setTimeout(
        function () {

            loading.classList.add(
                "hidden"
            );

        },
        250
    );

}


// ============================================================
// NEXT PAGE
// ============================================================

function nextPage() {

    if (!isReady || isPageTurning) {
        return;
    }


    if (
        currentPage >=
        totalPages
    ) {

        return;

    }


    turnAfterLoading(currentPage + 1, "next");

}


// ============================================================
// PREVIOUS PAGE
// ============================================================

function previousPage() {

    if (!isReady || isPageTurning) {
        return;
    }


    if (
        currentPage <= 1
    ) {

        return;

    }


    turnAfterLoading(currentPage - 1, "previous");

}


// ============================================================
// FIRST PAGE
// ============================================================

function goToFirstPage() {

    if (!isReady || isPageTurning) {
        return;
    }


    turnAfterLoading(1, "page", 1);

}


// ============================================================
// LAST PAGE
// ============================================================

function goToLastPage() {

    if (!isReady || isPageTurning) {
        return;
    }


    turnAfterLoading(totalPages, "page", totalPages);


    // Make sure the last page starts loading.

    loadPageImage(
        totalPages
    );

}


async function turnAfterLoading(pageNumber, action, actionPage) {

    if (isPageTurning) {
        return;
    }

    if (action === "page" && actionPage === currentPage) {
        return;
    }

    isPageTurning = true;

    const loaded = await ensurePageLoaded(pageNumber);

    if (!loaded) {
        isPageTurning = false;
        return;
    }

    if (actionPage === undefined) {
        $(book).turn(action);
    } else {
        $(book).turn(action, actionPage);
    }

}


// ============================================================
// BUTTON EVENTS
// ============================================================

if (elementExists(nextButton)) {

    nextButton.addEventListener(
        "click",
        nextPage
    );

}


if (elementExists(nextBottom)) {

    nextBottom.addEventListener(
        "click",
        nextPage
    );

}


if (elementExists(previousButton)) {

    previousButton.addEventListener(
        "click",
        previousPage
    );

}


if (elementExists(previousBottom)) {

    previousBottom.addEventListener(
        "click",
        previousPage
    );

}


if (elementExists(firstButton)) {

    firstButton.addEventListener(
        "click",
        goToFirstPage
    );

}


if (elementExists(lastButton)) {

    lastButton.addEventListener(
        "click",
        goToLastPage
    );

}


// ============================================================
// KEYBOARD NAVIGATION
// ============================================================

document.addEventListener(
    "keydown",
    function (event) {

        if (event.key === "Escape") {
            if (searchPanel && !searchPanel.hidden) {
                searchPanel.hidden = true;
                if (searchButton) searchButton.setAttribute("aria-expanded", "false");
            }
            if (document.body.classList.contains("thumbnails-open")) {
                setThumbnailSidebar(false);
            }
            return;
        }

        if (event.target instanceof HTMLElement && event.target.matches("input, textarea, select, [contenteditable='true']")) {
            return;
        }

        if (
            event.key ===
            "ArrowRight"
        ) {

            nextPage();

        }


        if (
            event.key ===
            "ArrowLeft"
        ) {

            previousPage();

        }


        if (
            event.key ===
            "Home"
        ) {

            goToFirstPage();

        }


        if (
            event.key ===
            "End"
        ) {

            goToLastPage();

        }

    }
);


// ============================================================
// ZOOM
// ============================================================

function updateZoom() {

    if (!bookStage) {
        return;
    }


    bookStage.style.transform =
        `scale(${zoomLevel})`;


    if (zoomValue) {

        zoomValue.textContent =
            `${Math.round(
                zoomLevel * 100
            )}%`;

    }

}


// ============================================================
// ZOOM IN
// ============================================================

if (elementExists(zoomIn)) {

    zoomIn.addEventListener(
        "click",
        function () {

            zoomLevel =
                Math.min(
                    zoomLevel + 0.1,
                    3
                );


            updateZoom();

        }
    );

}


// ============================================================
// ZOOM OUT
// ============================================================

if (elementExists(zoomOut)) {

    zoomOut.addEventListener(
        "click",
        function () {

            zoomLevel =
                Math.max(
                    zoomLevel - 0.1,
                    0.6
                );


            updateZoom();

        }
    );

}


// ============================================================
// DOUBLE CLICK ZOOM
// ============================================================

if (bookStage) {

    bookStage.addEventListener(
        "dblclick",
        function () {

            if (
                zoomLevel <= 1.5
            ) {

                zoomLevel =
                    1.8;

            } else {

                zoomLevel =
                    1;

            }


            updateZoom();

        }
    );

}


// ============================================================
// BACK TO PAGES
// ============================================================

if (elementExists(backToPagesButton)) {

    backToPagesButton.addEventListener(
        "click",
        function () {

            const params =
                new URLSearchParams(
                    window.location.search
                );

            const returnTo =
                params.get("return_to");

            const storedJobId =
                sessionStorage.getItem("pdfFlipbookLastJobId");

            if (returnTo) {

                try {

                    const returnUrl =
                        new URL(returnTo, window.location.origin);

                    if (returnUrl.origin === window.location.origin) {
                        window.location.href = returnUrl.toString();
                        return;
                    }

                } catch (error) {
                    console.warn("Invalid return target:", error);
                }

            }

            if (storedJobId) {
                window.location.href = `/?job_id=${encodeURIComponent(storedJobId)}`;
                return;
            }

            window.location.href = "/";

        }
    );

}


// ============================================================
// FULLSCREEN
// ============================================================

if (elementExists(fullscreenButton)) {

    fullscreenButton.addEventListener(
        "click",
        async function () {

            try {

                if (
                    !document.fullscreenElement
                ) {

                    await document
                        .documentElement
                        .requestFullscreen();

                } else {

                    await document
                        .exitFullscreen();

                }

            } catch (error) {

                console.error(
                    "Fullscreen error:",
                    error
                );

            }

        }
    );

}


// ============================================================
// TOUCH / SWIPE
// ============================================================

let touchStartX = null;


if (bookStage) {

    bookStage.addEventListener(
        "touchstart",
        function (event) {

            if (
                event.touches.length !== 1
            ) {

                return;

            }


            touchStartX =
                event.touches[0].clientX;

        },
        {
            passive: true
        }
    );


    bookStage.addEventListener(
        "touchend",
        function (event) {

            if (
                touchStartX === null
            ) {

                return;

            }


            const touchEndX =
                event.changedTouches[0].clientX;


            const difference =
                touchEndX -
                touchStartX;


            touchStartX =
                null;


            if (
                Math.abs(difference) < 40
            ) {

                return;

            }


            if (
                difference < 0
            ) {

                nextPage();

            } else {

                previousPage();

            }

        },
        {
            passive: true
        }
    );

}


// ============================================================
// WINDOW RESIZE
// ============================================================

let resizeTimer = null;


window.addEventListener(
    "resize",
    function () {

        clearTimeout(
            resizeTimer
        );


        resizeTimer =
            setTimeout(
                function () {

                    if (!isReady) {
                        return;
                    }


                    const size =
                        calculateBookSize();


                    try {

                        $(book).turn(
                            "size",
                            size.width,
                            size.height
                        );


                    } catch (error) {

                        console.warn(
                            "Could not resize flipbook:",
                            error
                        );

                    }

                },
                200
            );

    }
);


// ============================================================
// INITIALIZE FLIPBOOK
// ============================================================

async function initializeFlipbook() {

    // --------------------------------------------------------
    // STEP 1
    // Get job information from FastAPI
    // --------------------------------------------------------

    const loaded =
        await loadFlipbookData();


    if (!loaded) {
        return;
    }


    // --------------------------------------------------------
    // STEP 2
    // Set title
    // --------------------------------------------------------

    setBookTitle();
    flipbookSettings = sanitizeSettings({
        ...getDefaultSettings(),
        title: flipbookData && flipbookData.title ? flipbookData.title : "Flipbook"
    });
    await loadJobSettings();

    if (downloadButton && jobId) {
        downloadButton.href = `/api/job/${encodeURIComponent(jobId)}/download`;
        downloadButton.setAttribute("download", "Flipbook_Client_Package.zip");
    } else if (downloadButton) {
        downloadButton.classList.add("hidden");
    }

    loadSearchIndex();


    if (totalPagesElement) {

        totalPagesElement.textContent =
            totalPages;

    }


    // --------------------------------------------------------
    // STEP 3
    // Create all page containers
    //
    // This is VERY fast because we are NOT downloading
    // all images yet.
    // --------------------------------------------------------

    createAllPages();


    // --------------------------------------------------------
    // STEP 4
    // Load only first few high-resolution pages.
    // --------------------------------------------------------

    try {

        await loadInitialPages();


    } catch (error) {

        console.warn(
            "Initial page loading warning:",
            error
        );

    }


    // --------------------------------------------------------
    // STEP 5
    // Initialize Turn.js immediately.
    // --------------------------------------------------------

    initializeTurnJS();
    updateZoom();

}


// ============================================================
// START APPLICATION
// ============================================================

initializeFlipbook();
