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

function setBookTitle() {

    if (!elementExists(bookTitle)) {
        return;
    }


    if (
        flipbookData &&
        flipbookData.title &&
        flipbookData.title.trim()
    ) {

        bookTitle.textContent =
            flipbookData.title;

        document.title =
            flipbookData.title;

    } else {

        bookTitle.textContent =
            "Flipbook";

        document.title =
            "PDF Flipbook";

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

        currentPageElement.textContent =
            currentPage;

    }


    if (elementExists(totalPagesElement)) {

        totalPagesElement.textContent =
            totalPages;

    }


    updateNavigationButtons();


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
                book.querySelector(
                    `.page[data-page="${pageNumber}"]`
                );


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

