# Screenshot reader

Used by "Add from screenshots" on the Load data tab. It reads the text in a screenshot of the bank app's transaction list, in the browser, on the device; nothing is sent anywhere. Loaded only when you add a screenshot, then kept by the service worker for offline use.

- `tesseract.min.js`, `worker.min.js`: tesseract.js 7.0.0
- `tesseract-core-simd-lstm.wasm.js`, `tesseract-core-lstm.wasm.js`: tesseract.js-core 7.0.0 (SIMD for newer phones, plain for older ones)
- `eng.traineddata.gz`: English, `4.0.0_best_int`, from @tesseract.js-data/eng 1.0.0

All Apache License 2.0 (see LICENSE). When updating these, change `OCR_CACHE` in sw.js so phones fetch the new files.
