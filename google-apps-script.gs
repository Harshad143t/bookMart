/**
 * BookMart Google Sheets backend.
 *
 * Sheet tabs:
 * - users: id,password
 * - books: id,name,price,img,images,owner,condition
 */

function doGet(e) {
  return handleRequest_(e);
}

function doPost(e) {
  return handleRequest_(e);
}

function handleRequest_(e) {
  try {
    const request = parseRequest_(e);
    const action = String(request.action || "").trim();
    const spreadsheet = getSpreadsheet_();
    const usersSheet = spreadsheet.getSheetByName("users");
    const booksSheet = spreadsheet.getSheetByName("books");

    if (!usersSheet || !booksSheet) {
      return jsonResponse_({
        success: false,
        message: "Missing sheet tabs. Required: users, books."
      });
    }

    switch (action) {
      case "getUsers":
        return jsonResponse_({ success: true, users: getUsersMap_(usersSheet) });

      case "createUser":
        return createUser_(usersSheet, request);

      case "getBooks":
        return jsonResponse_({ success: true, books: getBooksArray_(booksSheet) });

      case "createBook":
        return createBook_(booksSheet, request);

      case "deleteBook":
        return deleteBook_(booksSheet, request);

      default:
        return jsonResponse_({ success: false, message: "Unknown action." });
    }
  } catch (error) {
    return jsonResponse_({ success: false, message: error.message });
  }
}

function parseRequest_(e) {
  const out = {};

  if (e && e.parameter) {
    if (e.parameter.action) out.action = e.parameter.action;

    if (e.parameter.payload) {
      const payloadObj = JSON.parse(e.parameter.payload);
      Object.keys(payloadObj).forEach(function (k) {
        out[k] = payloadObj[k];
      });
    }

    Object.keys(e.parameter).forEach(function (k) {
      if (k !== "payload") out[k] = e.parameter[k];
    });
  }

  if (Object.keys(out).length === 0 && e && e.postData && e.postData.contents) {
    const bodyObj = JSON.parse(e.postData.contents);
    Object.keys(bodyObj).forEach(function (k) {
      out[k] = bodyObj[k];
    });
  }

  return out;
}

function createUser_(usersSheet, request) {
  const id = String(request.id || "").trim();
  const password = String(request.password || "").trim();

  if (!id || !password) {
    return jsonResponse_({ success: false, message: "ID and password are required." });
  }

  const users = getUsersMap_(usersSheet);
  if (users[id]) {
    return jsonResponse_({ success: false, message: "User already exists." });
  }

  usersSheet.appendRow([id, password]);
  return jsonResponse_({ success: true, message: "User created." });
}

function createBook_(booksSheet, request) {
  const book = request.book || {};
  const id = String(book.id || "").trim();
  const name = String(book.name || "").trim();
  const price = String(book.price || "").trim();
  const owner = String(book.owner || "").trim();
  const condition = normalizeBookCondition_(book.condition);
  const img = String(book.img || "").trim();
  const images = normalizeImages_(book.images, img);

  if (!id || !name || !price || !owner) {
    return jsonResponse_({ success: false, message: "Missing required book fields." });
  }

  const headerMap = getBooksHeaderMap_(booksSheet);
  const rowValues = [];
  rowValues[headerMap.id] = id;
  rowValues[headerMap.name] = name;
  rowValues[headerMap.price] = price;
  rowValues[headerMap.img] = images[0];
  rowValues[headerMap.images] = JSON.stringify(images);
  rowValues[headerMap.owner] = owner;
  rowValues[headerMap.condition] = condition;

  booksSheet.appendRow(rowValues);
  return jsonResponse_({ success: true, message: "Book created." });
}

function deleteBook_(booksSheet, request) {
  const id = String(request.id || "").trim();
  if (!id) {
    return jsonResponse_({ success: false, message: "Book ID is required." });
  }

  const values = booksSheet.getDataRange().getValues();
  const headerMap = getBooksHeaderMap_(booksSheet);

  for (var i = values.length - 1; i >= 1; i--) {
    if (String(values[i][headerMap.id] || "") === id) {
      booksSheet.deleteRow(i + 1);
      return jsonResponse_({ success: true, message: "Book deleted." });
    }
  }

  return jsonResponse_({ success: false, message: "Book not found." });
}

function getUsersMap_(usersSheet) {
  const values = usersSheet.getDataRange().getValues();
  const users = {};

  for (var i = 1; i < values.length; i++) {
    const id = String(values[i][0] || "").trim();
    const password = String(values[i][1] || "").trim();
    if (id) users[id] = password;
  }

  return users;
}

function getBooksArray_(booksSheet) {
  const values = booksSheet.getDataRange().getValues();
  const books = [];
  const headerMap = getBooksHeaderMap_(booksSheet);

  for (var i = 1; i < values.length; i++) {
    const row = values[i];
    const img = String(row[headerMap.img] || "").trim();
    const imagesRaw = String(row[headerMap.images] || "").trim();
    const images = parseStoredImages_(imagesRaw, img);

    books.push({
      id: String(row[headerMap.id] || ""),
      name: String(row[headerMap.name] || ""),
      price: String(row[headerMap.price] || ""),
      img: img || images[0],
      images: images,
      owner: String(row[headerMap.owner] || ""),
      condition: normalizeBookCondition_(row[headerMap.condition])
    });
  }

  return books;
}
function parseStoredImages_(imagesRaw, imgFallback) {
  if (!imagesRaw) {
    return imgFallback ? [imgFallback] : [];
  }

  try {
    const parsed = JSON.parse(imagesRaw);
    if (!Array.isArray(parsed)) {
      return imgFallback ? [imgFallback] : [];
    }
    const cleaned = parsed
      .map(function (v) { return String(v || "").trim(); })
      .filter(function (v) { return v; });
    if (cleaned.length === 0) return imgFallback ? [imgFallback] : [];
    return cleaned;
  } catch (error) {
    return imgFallback ? [imgFallback] : [];
  }
}

function normalizeImages_(images, imgFallback) {
  const list = Array.isArray(images) ? images : [];
  const cleaned = list
    .map(function (v) { return String(v || "").trim(); })
    .filter(function (v) { return v; });
  if (cleaned.length > 0) return cleaned.slice(0, 4);

  const single = String(imgFallback || "").trim();
  return single ? [single] : [];
}

function normalizeBookCondition_(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return normalized === "new" ? "new" : "old";
}

function getBooksHeaderMap_(booksSheet) {
  const headers = booksSheet.getRange(1, 1, 1, booksSheet.getLastColumn()).getValues()[0];
  const nameToIndex = {};

  for (var i = 0; i < headers.length; i++) {
    const key = String(headers[i] || "").trim().toLowerCase();
    if (key) nameToIndex[key] = i;
  }

  return {
    id: indexOrDefault_(nameToIndex, "id", 0),
    name: indexOrDefault_(nameToIndex, "name", 1),
    price: indexOrDefault_(nameToIndex, "price", 2),
    img: indexOrDefault_(nameToIndex, "img", 3),
    images: indexOrDefault_(nameToIndex, "images", 4),
    owner: indexOrDefault_(nameToIndex, "owner", 5),
    condition: indexOrDefault_(nameToIndex, "condition", 6)
  };
}

function indexOrDefault_(map, key, fallback) {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : fallback;
}

function getSpreadsheet_() {
  // Preferred for bound scripts.
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;

  // Fallback for standalone deployments: set Script Property BOOKMART_SHEET_ID.
  const props = PropertiesService.getScriptProperties();
  const sheetId = String(props.getProperty("BOOKMART_SHEET_ID") || "").trim();
  if (!sheetId) {
    throw new Error(
      "No spreadsheet available. Bind this script to your sheet, or set Script Property BOOKMART_SHEET_ID."
    );
  }

  try {
    return SpreadsheetApp.openById(sheetId);
  } catch (error) {
    throw new Error(
      "Could not open spreadsheet ID " +
        sheetId +
        ". Check that the sheet exists and the Apps Script deployment owner has edit access."
    );
  }
}

function jsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}


