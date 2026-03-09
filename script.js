const SHEETS_API_URL = window.BOOKMART_SHEETS_API_URL || "PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE";
const DEFAULT_BOOK_IMAGE = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='320' height='440' viewBox='0 0 320 440'%3E%3Crect width='320' height='440' fill='%23eef2f7'/%3E%3Crect x='24' y='34' width='272' height='372' rx='16' fill='%23ffffff' stroke='%23d4dce6'/%3E%3Ctext x='160' y='214' font-size='24' fill='%23808a99' text-anchor='middle' font-family='Arial,sans-serif'%3ENo Image%3C/text%3E%3C/svg%3E";
const MAX_BOOK_IMAGES = 4;
const MAX_BOOK_PRICE = 100;
const MIN_BOOK_PRICE = 1;
const MAX_BOOK_NAME_LENGTH = 40;
const UPLOAD_IMAGE_MAX_DIMENSION = 1280;
const UPLOAD_IMAGE_QUALITY = 0.68;
const UPLOAD_IMAGE_OUTPUT_TYPE = "image/jpeg";
const VALID_BOOK_NAME_REGEX = /^[A-Za-z0-9\s.,'&()+\-/:]+$/;
const BOOKS_CACHE_KEY = "bookmart_books_cache_v1";
const BOOKS_CACHE_TTL_MS = 5 * 60 * 1000;
const BOOK_CONDITIONS = Object.freeze({
    OLD: "old",
    NEW: "new"
});
let selectedBookImagesDataUrls = [];
let activeBuyImages = [DEFAULT_BOOK_IMAGE];
let activeBuyImageIndex = 0;
let booksMemoryCache = null;
let booksCacheTimestamp = 0;

function isSheetsConfigured() {
    return SHEETS_API_URL && !SHEETS_API_URL.includes("PASTE_YOUR_GOOGLE_APPS_SCRIPT_WEB_APP_URL_HERE");
}

// --- LOADING ANIMATION 
function showLoading(message = "Processing...") {
    let loader = document.getElementById("global-loader");
    if (!loader) {
        loader = document.createElement("div");
        loader.id = "global-loader";
        Object.assign(loader.style, {
            position: "fixed", top: "0", left: "0", width: "100%", height: "100%",
            backgroundColor: "rgba(255, 255, 255, 0.8)", zIndex: "9999",
            display: "flex", flexDirection: "column", justifyContent: "center", alignItems: "center",
            fontFamily: "sans-serif", fontSize: "18px", color: "#1e3a5f", backdropFilter: "blur(5px)"
        });
        loader.innerHTML = `
            <div style="width: 50px; height: 50px; border: 5px solid #e9ecef; border-top: 5px solid #4a90e2; border-radius: 50%; animation: spinLoader 1s linear infinite; margin-bottom: 15px;"></div>
            <div id="loader-text" style="font-weight: 600;">${message}</div>
            <style>@keyframes spinLoader { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }</style>
        `;
        document.body.appendChild(loader);
    } else {
        document.getElementById("loader-text").innerText = message;
        loader.style.display = "flex";
    }
}

function hideLoading() {
    const loader = document.getElementById("global-loader");
    if (loader) loader.style.display = "none";
}




async function apiRequest(action, payload = {}) {
    if (!isSheetsConfigured()) {
        throw new Error("Google Sheets API URL is not configured yet.");
    }

    const formBody = new URLSearchParams({
        action,
        payload: JSON.stringify(payload)
    });

    let response;
    try {
        response = await fetch(SHEETS_API_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8"
            },
            body: formBody.toString()
        });
    } catch (networkError) {
        throw new Error("Network error while reaching Google Apps Script. Check deployment access (Anyone) and URL.");
    }

    if (!response.ok) {
        throw new Error(`Request failed with status ${response.status}`);
    }

    let data;
    try {
        data = await response.json();
    } catch (parseError) {
        throw new Error("Apps Script did not return valid JSON. Re-deploy the latest script version.");
    }

    if (!data.success) {
        throw new Error(data.message || "Google Sheets request failed.");
    }

    return data;
}

async function fetchBooks() {
    const data = await apiRequest("getBooks");
    return data.books || [];
}

function orderBooks(books) {
    return [...books].sort((a, b) => {
        const idA = Number(a.id);
        const idB = Number(b.id);
        if (Number.isFinite(idA) && Number.isFinite(idB)) return idA - idB;
        return 0;
    });
}

function persistBooksCache(books, timestamp = Date.now()) {
    const orderedBooks = orderBooks(books);
    booksMemoryCache = orderedBooks;
    booksCacheTimestamp = timestamp;

    try {
        localStorage.setItem(
            BOOKS_CACHE_KEY,
            JSON.stringify({
                timestamp,
                books: orderedBooks
            })
        );
    } catch (error) {
    }

    return orderedBooks;
}

function loadBooksCache() {
    if (Array.isArray(booksMemoryCache)) {
        if (isBooksCacheFresh()) {
            return booksMemoryCache;
        }
        booksMemoryCache = null;
        booksCacheTimestamp = 0;
    }

    try {
        const raw = localStorage.getItem(BOOKS_CACHE_KEY);
        if (!raw) return null;

        const parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.books)) return null;

        const timestamp = Number(parsed.timestamp);
        if (!Number.isFinite(timestamp)) return null;
        if (Date.now() - timestamp > BOOKS_CACHE_TTL_MS) return null;

        booksCacheTimestamp = timestamp;
        booksMemoryCache = orderBooks(parsed.books);
        return booksMemoryCache;
    } catch (error) {
        return null;
    }
}

function isBooksCacheFresh() {
    return Number.isFinite(booksCacheTimestamp) && booksCacheTimestamp > 0 && (Date.now() - booksCacheTimestamp) <= BOOKS_CACHE_TTL_MS;
}

async function getBooks({ forceRefresh = false } = {}) {
    const cachedBooks = loadBooksCache();
    if (!forceRefresh && cachedBooks && isBooksCacheFresh()) {
        return { books: cachedBooks, source: "cache" };
    }

    const freshBooks = await fetchBooks();
    const orderedFreshBooks = persistBooksCache(freshBooks);
    return { books: orderedFreshBooks, source: "network" };
}

async function fetchUsers() {
    const data = await apiRequest("getUsers");
    return data.users || {};
}

document.addEventListener("DOMContentLoaded", async function () {
    const profileBtn = document.getElementById("profile");
    const searchBtn = document.getElementById("searchBtn");
    const searchInput = document.getElementById("searchBook");
    const menuToggleBtn = document.getElementById("menuToggle");
    
    if (profileBtn) {
        setupProfileButton(profileBtn);
    }
    if (menuToggleBtn) {
        setupMenuToggle(menuToggleBtn);
    }

    if (searchBtn) {
        searchBtn.addEventListener("click", searchBooks);
    }

    if (searchInput) {
        searchInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                searchBooks();
            }
        });
    }

    const bookContainer = document.getElementById("container");
    if (bookContainer) {
        await loadAndDisplayBooks();
    }

    document.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
            const buyPage = document.getElementById("buyPage");
            if (buyPage && buyPage.style.display === "flex") {
                Done();
            }
        }
    });

    if (window.location.href.includes("createAc.html")) {
        const box = document.createElement("div");
        box.className = "warning-box";
        box.innerHTML = `
          <p>Make sure to note your ID and password. Because You won’t be able to recover them later as of now.</p>
          <button class="warning-ok-btn">OK</button>
        `;
        document.body.appendChild(box);

        box.querySelector(".warning-ok-btn").addEventListener("click", function () {
            box.remove();
        });
    }
});

function setupProfileButton(profileBtn) {
    const loggedUser = localStorage.getItem("loggedUser");

    if (loggedUser) {
        document.getElementById("loggeduser").innerText = `UserId:${loggedUser}`;
        profileBtn.innerText = "Log out";
        profileBtn.onclick = function () {
            showDialog("Are you sure you want to log out?", () => {
                logOut();
            });
        };
        return;
    }

    profileBtn.innerText = "Log in";
    profileBtn.onclick = logInbtn;
}

function setupMenuToggle(menuToggleBtn) {
    const navActions = document.querySelector(".nav-actions");
    if (!navActions) return;

    menuToggleBtn.addEventListener("click", function () {
        const isOpen = navActions.classList.toggle("open");
        menuToggleBtn.setAttribute("aria-expanded", isOpen ? "true" : "false");
    });
}

function showDialog(message, onConfirm, onCancel) {
    const existing = document.querySelector(".dialog-overlay");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.className = "dialog-overlay";
    overlay.innerHTML = `
        <div class="custom-dialog">
            <p>${message}</p>
            <button id="dialogYes">Yes</button>
            <button id="dialogNo">No</button>
        </div>
    `;
    document.body.appendChild(overlay);

    document.getElementById("dialogYes").onclick = () => {
        overlay.remove();
        if (onConfirm) onConfirm();
    };
    document.getElementById("dialogNo").onclick = () => {
        overlay.remove();
        if (onCancel) onCancel();
    };
}

function logInbtn() {
    window.location.href = "index.html";
}

function logOut() {
    localStorage.removeItem("loggedUser");
    alert("Logged out successfully!");
    window.location.href = "index.html";
}

async function login(event) {
    event.preventDefault();

    const enterId = document.getElementById("number");
    const enterPass = document.getElementById("passwd");

    const id = enterId.value.trim();
    const pass = enterPass.value.trim();

    if (!id || !pass) {
        alert("Empty fields not allowed");
        return;
    }

    showLoading("Signing in...");
    try {
        const users = await fetchUsers();

        if (Object.prototype.hasOwnProperty.call(users, id) && users[id] === pass) {
            localStorage.setItem("loggedUser", id);
            window.location.href = "home.html";
            return;
        }

        if (Object.prototype.hasOwnProperty.call(users, id) && users[id] !== pass) {
            alert("Incorrect ID or password.");
            return;
        }

        alert("No ID found with such information!");
    } catch (error) {
        alert(`Login failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function creatId(event) {
    if (event) event.preventDefault();

    const userId = document.getElementById("number");
    const userPass = document.getElementById("Pass");
    const userConfPass = document.getElementById("passs");

    const password = userPass.value.trim();
    const confirmPass = userConfPass.value.trim();
    const id = userId.value.trim();

    if (!id || !confirmPass || !password) {
        alert("Empty fields not allowed");
        return;
    }
    if (id.length < 10) {
        alert("ID must be at least 10 characters long.");
        return;
    }
    if (password.length < 5) {
        alert("Password must be at least 5 characters long.");
        return;
    }
    if (password !== confirmPass) {
        alert("Enter matching passwords");
        return;
    }

    showLoading("Creating account...");
    try {
        const users = await fetchUsers();
        if (Object.prototype.hasOwnProperty.call(users, id)) {
            alert("This ID is already in use");
            return;
        }

        await apiRequest("createUser", { id, password });
        localStorage.setItem("loggedUser", id);
        alert("Account created successfully!");
        window.location.href = "home.html";
    } catch (error) {
        alert(`Account creation failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

function postBook() {
    const loggedUser = localStorage.getItem("loggedUser");
    if (!loggedUser) {
        alert("You need to log in to post a book.");
        return;
    }

    const divElement = document.getElementById("createBooksss");
    if (divElement) {
        divElement.style.display = divElement.style.display === "none" ? "flex" : "none";
    }
}

function cancel() {
    const divElement = document.getElementById("createBooksss");
    divElement.style.display = divElement.style.display === "none" ? "flex" : "none";
}

async function addNewBook() {
    const bookPriceInput = document.getElementById("enterPrice").value.trim();
    const bookName = document.getElementById("enterbookname").value.trim();
    const bookCondition = normalizeBookCondition(document.getElementById("bookCondition")?.value);
    const bookPrice = Number(bookPriceInput);
    const bookImages = selectedBookImagesDataUrls.length > 0 ? [...selectedBookImagesDataUrls] : [DEFAULT_BOOK_IMAGE];
    const bookimg = bookImages[0];

    const validationError = validateBookInput(bookName, bookPriceInput, bookPrice, bookCondition);
    if (validationError) {
        alert(validationError);
        return;
    }

    const loggedUser = localStorage.getItem("loggedUser");
    if (!loggedUser) {
        alert("You need to log in to post a book.");
        return;
    }

    const book = {
        id: Date.now().toString(),
        name: bookName,
        price: String(bookPrice),
        img: bookimg,
        images: bookImages,
        condition: bookCondition,
        owner: loggedUser
    };

    showLoading("Uploading book...");
    try {
        await apiRequest("createBook", { book });
        persistBooksCache([...(booksMemoryCache || []), book]);

        const divElement = document.getElementById("createBooksss");
        divElement.style.display = "none";
        displayBook(book);
        clearInputs();
    } catch (error) {
        alert(`Failed to post book: ${error.message}`);
    } finally {
        hideLoading();
    }
}

async function loadAndDisplayBooks() {
    const container = document.getElementById("container");
    if (!container) return;

    const cachedBooks = loadBooksCache();
    if (cachedBooks) {
        renderBooks(cachedBooks);
    } else {
        showLoading("Loading books...");
    }

    try {
        const { books } = await getBooks({ forceRefresh: !cachedBooks });
        renderBooks(books);
    } catch (error) {
        if (!cachedBooks) {
            alert(`Could not load books: ${error.message}`);
        }
    } finally {
        hideLoading();
    }
}

function createBookCard(book) {
    const bookImages = getBookImages(book);
    const safeBookImg = bookImages[0];
    const newBook = document.createElement("div");
    newBook.className = "books";
    newBook.setAttribute("data-id", book.id);
    newBook.innerHTML = `
        <div class="bookImg">
            <img src="${safeBookImg || DEFAULT_BOOK_IMAGE}" alt="book image">
            <button class="bookDelBtn">Remove</button>
        </div>
        <div class="bookInfo">
            <p class="bookname">Book name: ${book.name}</p>
            <p class="price">Price: <span class="Price">${book.price}</span> RS</p>
            <p class="bookCondition">Condition: <span class="bookConditionValue">${getBookConditionLabel(book.condition)}</span></p>
            <button class="buyBtn">Buy now</button>
        </div>`;
    const bookImgElement = newBook.querySelector(".bookImg img");
    if (bookImgElement) {
        bookImgElement.onerror = function () {
            this.onerror = null;
            this.src = DEFAULT_BOOK_IMAGE;
        };
    }

    const loggedUser = localStorage.getItem("loggedUser");
    if (book.owner === loggedUser) {
        newBook.querySelector(".bookDelBtn").style.display = "flex";
    }

    newBook.querySelector(".buyBtn").addEventListener("click", function () {
        buyBook(book.owner, book.name, book.price, bookImages, book.condition);
    });

    newBook.querySelector(".bookDelBtn").addEventListener("click", function () {
        removeBook(book.id, this);
    });

    return newBook;
}
function displayBook(book, options = {}) {
    const { prepend = false } = options;
    const container = document.getElementById("container");
    if (!container) return;

    const bookCard = createBookCard(book);
    if (prepend) {
        container.prepend(bookCard);
    } else {
        container.append(bookCard);
    }
}

function renderBooks(books) {
    const container = document.getElementById("container");
    if (!container) return;

    const existingBooks = Array.from(container.querySelectorAll(".books"));
    existingBooks.forEach((book) => book.remove());

    const fragment = document.createDocumentFragment();
    books.forEach((book) => {
        fragment.appendChild(createBookCard(book));
    });
    container.appendChild(fragment);
}
function clearInputs() {
    document.getElementById("enterbookname").value = "";
    document.getElementById("enterPrice").value = "";
    const conditionSelect = document.getElementById("bookCondition");
    if (conditionSelect) conditionSelect.value = BOOK_CONDITIONS.OLD;
    selectedBookImagesDataUrls = [];

    const galleryInput = document.getElementById("addphotoGallery");
    if (galleryInput) galleryInput.value = "";

    const previewList = document.getElementById("photoPreviewList");
    const pickerText = document.getElementById("photoPickerText");
    if (previewList) previewList.innerHTML = "";
    if (pickerText) pickerText.innerText = "Add book photos (max 4)";
}

function openPhotoSourcePicker() {
    if (selectedBookImagesDataUrls.length >= MAX_BOOK_IMAGES) {
        alert(`You can upload up to ${MAX_BOOK_IMAGES} images only.`);
        return;
    }

    const galleryInput = document.getElementById("addphotoGallery");
    if (galleryInput) galleryInput.click();
}

function readFileAsDataUrl(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Could not read the selected image file."));
        reader.readAsDataURL(file);
    });
}

function loadImageFromDataUrl(dataUrl) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("Could not decode the selected image."));
        img.src = dataUrl;
    });
}

function getScaledDimensions(width, height, maxDimension) {
    if (width <= maxDimension && height <= maxDimension) {
        return { width, height };
    }

    if (width >= height) {
        return {
            width: maxDimension,
            height: Math.max(1, Math.round((height / width) * maxDimension))
        };
    }

    return {
        width: Math.max(1, Math.round((width / height) * maxDimension)),
        height: maxDimension
    };
}

async function optimizeImageForUpload(file) {
    const originalDataUrl = await readFileAsDataUrl(file);
    if (!originalDataUrl) {
        throw new Error("Image data is empty.");
    }
    if (file.type === "image/gif") {
        return originalDataUrl;
    }

    try {
        const image = await loadImageFromDataUrl(originalDataUrl);
        const { width, height } = getScaledDimensions(image.width, image.height, UPLOAD_IMAGE_MAX_DIMENSION);
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;

        const context = canvas.getContext("2d");
        if (!context) return originalDataUrl;

        context.imageSmoothingEnabled = true;
        context.imageSmoothingQuality = "high";
        context.drawImage(image, 0, 0, width, height);

        const compressedDataUrl = canvas.toDataURL(UPLOAD_IMAGE_OUTPUT_TYPE, UPLOAD_IMAGE_QUALITY);
        if (!compressedDataUrl || compressedDataUrl.length >= originalDataUrl.length) {
            return originalDataUrl;
        }

        return compressedDataUrl;
    } catch (error) {
        return originalDataUrl;
    }
}

async function handleBookImageSelect(event) {
    const files = Array.from(event.target.files || []);
    if (files.length === 0) return;

    const remainingSlots = MAX_BOOK_IMAGES - selectedBookImagesDataUrls.length;
    if (remainingSlots <= 0) {
        alert(`You can upload up to ${MAX_BOOK_IMAGES} images only.`);
        event.target.value = "";
        return;
    }

    if (files.length > remainingSlots) {
        alert(`You can only add ${remainingSlots} more image(s).`);
    }

    const filesToProcess = files.slice(0, remainingSlots);
    const pickerText = document.getElementById("photoPickerText");
    if (pickerText) pickerText.innerText = "Optimizing photo...";

    for (const file of filesToProcess) {
        if (!file.type.startsWith("image/")) {
            alert("Please select an image file.");
            continue;
        }

        try {
            const optimizedDataUrl = await optimizeImageForUpload(file);
            selectedBookImagesDataUrls.push(optimizedDataUrl);
        } catch (error) {
            alert("Could not process one of the selected images.");
        }
    }

    renderSelectedPhotoPreviews();
    event.target.value = "";
}

function renderSelectedPhotoPreviews() {
    const previewList = document.getElementById("photoPreviewList");
    const pickerText = document.getElementById("photoPickerText");

    if (previewList) {
        previewList.innerHTML = selectedBookImagesDataUrls
            .map((img, index) => `
                <div class="photo-thumb-wrap">
                    <img class="photo-thumb" src="${img}" alt="Selected photo ${index + 1}">
                </div>
            `)
            .join("");
    }
    if (pickerText) {
        pickerText.innerText = selectedBookImagesDataUrls.length === 0
            ? "Add book photos (max 4)"
            : `${selectedBookImagesDataUrls.length}/${MAX_BOOK_IMAGES} photo(s) selected`;
    }
}

function validateBookInput(bookName, rawPrice, numericPrice, condition) {
    if (!rawPrice || !bookName) {
        return "Please enter book name and price. Image is optional.";
    }
    if (!Number.isFinite(numericPrice) || !/^\d+(\.\d{1,2})?$/.test(rawPrice)) {
        return "Enter a valid price (up to 2 decimal places).";
    }
    if (numericPrice < MIN_BOOK_PRICE) {
        return `Book price must be at least ${MIN_BOOK_PRICE}.`;
    }
    if (numericPrice > MAX_BOOK_PRICE) {
        return "Book price is too high.";
    }
    if (bookName.length > MAX_BOOK_NAME_LENGTH) {
        return "Book name is too long.";
    }
    if (!VALID_BOOK_NAME_REGEX.test(bookName)) {
        return "Book name contains invalid characters.";
    }
    if (!Object.values(BOOK_CONDITIONS).includes(condition)) {
        return "Please select a valid book condition.";
    }
    return "";
}

function normalizeBookCondition(value) {
    const normalized = String(value || "").trim().toLowerCase();
    if (normalized === BOOK_CONDITIONS.NEW) return BOOK_CONDITIONS.NEW;
    return BOOK_CONDITIONS.OLD;
}

function getBookConditionLabel(value) {
    return normalizeBookCondition(value) === BOOK_CONDITIONS.NEW ? "New" : "Old (2nd hand)";
}

function getBookImages(book) {
    const imagesFromBook = Array.isArray(book.images) ? book.images : [];
    const parsedFromImgField = parseLegacyBookImagesFromImgField(book.img);
    const fallbackList = imagesFromBook.length > 0 ? imagesFromBook : parsedFromImgField;
    const cleaned = fallbackList
        .map((item) => (item == null ? "" : String(item).trim()))
        .filter((item) => item.length > 0);
    return cleaned.length > 0 ? cleaned : [DEFAULT_BOOK_IMAGE];
}

function parseLegacyBookImagesFromImgField(imgField) {
    const raw = imgField == null ? "" : String(imgField).trim();
    if (!raw) return [DEFAULT_BOOK_IMAGE];

    const legacyPrefix = "BOOK_IMAGES::";
    if (!raw.startsWith(legacyPrefix)) {
        return [raw];
    }

    const serialized = raw.slice(legacyPrefix.length);
    try {
        const parsed = JSON.parse(serialized);
        if (!Array.isArray(parsed)) return [DEFAULT_BOOK_IMAGE];
        const cleaned = parsed
            .map((item) => (item == null ? "" : String(item).trim()))
            .filter((item) => item.length > 0);
        return cleaned.length > 0 ? cleaned : [DEFAULT_BOOK_IMAGE];
    } catch (error) {
        return [DEFAULT_BOOK_IMAGE];
    }
}

function buyBook(owner, name, price, images, condition) {
    const bookImages = Array.isArray(images) && images.length > 0 ? images : [DEFAULT_BOOK_IMAGE];
    const slidesContainer = document.getElementById("buyPageThumbs");
    const prevBtn = document.getElementById("buyPrevBtn");
    const nextBtn = document.getElementById("buyNextBtn");
    const extraImages = bookImages.slice(1);
    activeBuyImages = bookImages.map((img) => img || DEFAULT_BOOK_IMAGE);
    activeBuyImageIndex = 0;
    updateBuyMainImage();

    const hasMultipleImages = activeBuyImages.length > 1;
    const isMobileView = window.matchMedia("(max-width: 640px)").matches;
    const showArrows = hasMultipleImages && isMobileView;
    if (prevBtn) prevBtn.style.display = showArrows ? "flex" : "none";
    if (nextBtn) nextBtn.style.display = showArrows ? "flex" : "none";

    if (slidesContainer) {
        slidesContainer.innerHTML = "";
        if (extraImages.length === 0) {
            slidesContainer.style.display = "none";
        } else {
            slidesContainer.style.display = "flex";
            extraImages.forEach((imgSrc, index) => {
                const slideBtn = document.createElement("button");
                slideBtn.className = "buy-slide-btn";
                slideBtn.type = "button";

                const slideImg = document.createElement("img");
                slideImg.className = "buy-slide-img";
                slideImg.src = imgSrc || DEFAULT_BOOK_IMAGE;
                slideImg.alt = `Book slide ${index + 2}`;
                slideImg.onerror = function () {
                    this.onerror = null;
                    this.src = DEFAULT_BOOK_IMAGE;
                };

                slideBtn.appendChild(slideImg);
                slideBtn.addEventListener("click", function () {
                    activeBuyImageIndex = index + 1;
                    updateBuyMainImage();
                });
                slidesContainer.appendChild(slideBtn);
            });
        }
    }

    document.getElementById("bookPageName").innerText = `Book Name : ${name}`;
    document.getElementById("bookPagePrice").innerText = `Book Price : ${price} Rs`;
    const conditionLabel = getBookConditionLabel(condition);
    document.getElementById("bookPageCondition").innerText = `Condition : ${conditionLabel}`;
    document.getElementById("ContactNumber").innerText = `Contact : ${owner}`;

    const buyPage = document.getElementById("buyPage");
    const buyBackdrop = document.getElementById("buyBackdrop");
    if (buyBackdrop) buyBackdrop.style.display = "block";
    buyPage.style.display = "flex";
}

function updateBuyMainImage() {
    const bImg = document.getElementById("buyPageImg");
    const counter = document.getElementById("buyImageCounter");
    const thumbsContainer = document.getElementById("buyPageThumbs");
    if (!bImg) return;
    const imgSrc = activeBuyImages[activeBuyImageIndex] || DEFAULT_BOOK_IMAGE;
    bImg.src = imgSrc;
    bImg.onerror = function () {
        this.onerror = null;
        this.src = DEFAULT_BOOK_IMAGE;
    };

    if (counter) {
        if (activeBuyImages.length > 1) {
            counter.style.display = "block";
            counter.innerText = `${activeBuyImageIndex + 1} / ${activeBuyImages.length}`;
        } else {
            counter.style.display = "none";
            counter.innerText = "";
        }
    }

    if (thumbsContainer) {
        const thumbButtons = Array.from(thumbsContainer.querySelectorAll(".buy-slide-btn"));
        thumbButtons.forEach((btn, index) => {
            btn.classList.toggle("active", index + 1 === activeBuyImageIndex);
        });
    }
}

function showPrevBuyImage() {
    if (!Array.isArray(activeBuyImages) || activeBuyImages.length <= 1) return;
    activeBuyImageIndex = (activeBuyImageIndex - 1 + activeBuyImages.length) % activeBuyImages.length;
    updateBuyMainImage();
}

function showNextBuyImage() {
    if (!Array.isArray(activeBuyImages) || activeBuyImages.length <= 1) return;
    activeBuyImageIndex = (activeBuyImageIndex + 1) % activeBuyImages.length;
    updateBuyMainImage();
}

async function removeBook(bookId, buttonElement) {
    showDialog("Are you sure you want to delete this book?", async () => {
        showLoading("Deleting book...");
        try {
            await apiRequest("deleteBook", { id: bookId });
            const bookDiv = buttonElement.closest(".books");
            if (bookDiv) bookDiv.remove();
            const cachedBooks = loadBooksCache() || [];
            persistBooksCache(cachedBooks.filter((book) => String(book.id) !== String(bookId)));
        } catch (error) {
            alert(`Failed to delete book: ${error.message}`);
        } finally {
            hideLoading();
        }
    });
}

function Done() {
    const buyPage = document.getElementById("buyPage");
    const buyBackdrop = document.getElementById("buyBackdrop");
    if (buyBackdrop) buyBackdrop.style.display = "none";
    buyPage.style.display = "none";
}

async function searchBooks() {
    const bookName = document.getElementById("searchBook").value.trim().toLowerCase();

    try {
        if (!loadBooksCache()) {
            showLoading("Searching...");
        }
        const { books: storedBooks } = await getBooks();

        const foundBooks = bookName
            ? storedBooks.filter((book) => book.name.toLowerCase().includes(bookName))
            : storedBooks;

        if (foundBooks.length === 0) {
            alert("No books found matching that name.");
            return;
        }

        renderBooks(foundBooks);
    } catch (error) {
        alert(`Search failed: ${error.message}`);
    } finally {
        hideLoading();
    }
}

function openBuyPage() {
    document.getElementById("buyPage").style.display = "flex";
    document.getElementById("nav").style.filter = "blur(5px)";
}

function closeBuyPage() {
    document.getElementById("buyPage").style.display = "none";
    document.getElementById("nav").style.filter = "none";
}







