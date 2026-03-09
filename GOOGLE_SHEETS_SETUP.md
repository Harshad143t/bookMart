# BookMart Google Sheets Backend Setup

## 1) Create a new spreadsheet
1. Create a new Google Sheet.
2. Create tab `users` with row-1 headers:
   - `id`
   - `password`
3. Create tab `books` with row-1 headers:
   - `id`
   - `name`
   - `price`
   - `img`
   - `images`
   - `owner`
   - `condition`

## 2) Add Apps Script backend
1. Open the sheet.
2. Go to `Extensions -> Apps Script`.
3. Replace the script with the contents of `google-apps-script.gs`.
4. Save.

## 3) Deploy web app
1. Click `Deploy -> New deployment`.
2. Type: `Web app`.
3. Execute as: `Me`.
4. Who has access: `Anyone`.
5. Deploy and copy the `/exec` URL.

## 4) Configure frontend
1. Open `config.js`.
2. Set `window.BOOKMART_SHEETS_API_URL` to the new `/exec` URL.

## 5) Test
1. Create account from `createAc.html`.
2. Login from `index.html`.
3. Upload a book with 2-4 photos from `home.html`.
4. Refresh and verify all images still appear in the buy popup slider.
5. Check Google Sheet `books` rows:
   - `img` contains default cover image (first image).
   - `images` contains JSON array of all selected images.
   - `condition` contains `old` or `new`.

## 6) If requests fail
1. Confirm deployment access is `Anyone`.
2. After script changes, deploy a **new version** and update `config.js` URL.
3. Hard refresh browser (`Ctrl+Shift+R`).
