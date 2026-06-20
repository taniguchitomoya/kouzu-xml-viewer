// State variables
let parcels = [];
let fileList = [];
let activeFileIndex = -1;
let selectedParcelId = null;
let hoveredParcelId = null;
let currentZipXmls = []; // Array of XML files extracted from loaded ZIP
let activeLegendChome = null; // Filter state for chome highlighting

// Map viewport configuration
let bounds = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
const viewState = {
    zoom: 1.0,
    offsetX: 0,
    offsetY: 0,
    isDragging: false,
    startX: 0,
    startY: 0
};

// DOM elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const serverFileList = document.getElementById('serverFileList');
const parcelList = document.getElementById('parcelList');
const parcelCountBadge = document.getElementById('parcelCountBadge');
const searchInput = document.getElementById('searchInput');
const clearSearchBtn = document.getElementById('clearSearchBtn');
const mapTitle = document.getElementById('mapTitle');
const metaCrs = document.getElementById('metaCrs');
const metaCity = document.getElementById('metaCity');
const metaScale = document.getElementById('metaScale');
const resetViewBtn = document.getElementById('resetViewBtn');
const printModeBtn = document.getElementById('printModeBtn');
const resetViewBtnOverlay = document.getElementById('resetViewBtnOverlay');
const zoomInBtn = document.getElementById('zoomInBtn');
const zoomOutBtn = document.getElementById('zoomOutBtn');
const mapCanvas = document.getElementById('mapCanvas');
const viewportContainer = document.getElementById('viewportContainer');
const hoverTooltip = document.getElementById('hoverTooltip');
const statusCoords = document.getElementById('statusCoords');
const statusHovered = document.getElementById('statusHovered');
const statusScale = document.getElementById('statusScale');
const mapSheetSelectContainer = document.getElementById('mapSheetSelectContainer');
const mapSheetSelect = document.getElementById('mapSheetSelect');
const legendOverlay = document.getElementById('legendOverlay');
const legendList = document.getElementById('legendList');
const loadingOverlay = document.getElementById('loadingOverlay');
const loadingMessage = document.getElementById('loadingMessage');

function showLoading(msg) {
    if (loadingMessage && loadingOverlay) {
        loadingMessage.textContent = msg;
        loadingOverlay.style.display = 'flex';
    }
}

function hideLoading() {
    if (loadingOverlay) {
        loadingOverlay.style.display = 'none';
    }
}

// Canvas context
const ctx = mapCanvas.getContext('2d');

// Initialize
window.addEventListener('DOMContentLoaded', () => {
    setupResizeHandler();
    setupInteractionEvents();
    setupFileEvents();
    setupSearch();
    scanDataDirectory();
    
    // Bind Print Mode toggle
    if (printModeBtn) {
        printModeBtn.addEventListener('click', () => {
            document.body.classList.toggle('print-mode');
            updatePrintButtonLabel();
            buildLegend();
            drawMap();
        });
    }
    
    // Listen to physical print events
    let wasPrintModeBeforePrint = false;
    window.addEventListener('beforeprint', () => {
        wasPrintModeBeforePrint = document.body.classList.contains('print-mode');
        if (!wasPrintModeBeforePrint) {
            document.body.classList.add('print-mode');
            updatePrintButtonLabel();
            buildLegend();
            drawMap();
        }
    });
    window.addEventListener('afterprint', () => {
        if (!wasPrintModeBeforePrint) {
            document.body.classList.remove('print-mode');
            updatePrintButtonLabel();
            buildLegend();
            drawMap();
        }
    });
    
    // Bind Map Sheet dropdown change event
    mapSheetSelect.addEventListener('change', () => {
        const index = parseInt(mapSheetSelect.value);
        if (currentZipXmls[index]) {
            showLoading('XML展開＆パース中...');
            setTimeout(async () => { // small delay to let UI update loading state
                try {
                    let xmlText = currentZipXmls[index].text;
                    if (!xmlText) {
                        xmlText = await currentZipXmls[index].file.async('text');
                        currentZipXmls[index].text = xmlText; // Cache for future switches
                    }
                    parseMojXml(xmlText);
                } catch (err) {
                    alert('XML読み込みエラー: ' + err.message);
                    hideLoading();
                }
            }, 50);
        }
    });
});

function updatePrintButtonLabel() {
    if (!printModeBtn) return;
    const isPrint = document.body.classList.contains('print-mode');
    if (isPrint) {
        printModeBtn.textContent = '🌙 通常モード';
        printModeBtn.classList.add('active');
    } else {
        printModeBtn.textContent = '🖨️ 印刷用(白)';
        printModeBtn.classList.remove('active');
    }
}

// Resize canvas to fit container
function setupResizeHandler() {
    const resizeObserver = new ResizeObserver(entries => {
        for (let entry of entries) {
            const width = entry.contentRect.width;
            const height = entry.contentRect.height;
            mapCanvas.width = width;
            mapCanvas.height = height;
            drawMap();
        }
    });
    resizeObserver.observe(viewportContainer);
}

// 1. Directory Scanning (Fetch files inside data/)
async function scanDataDirectory() {
    try {
        serverFileList.innerHTML = '<li class="loading">スキャン中...</li>';
        const response = await fetch('./data/');
        if (!response.ok) {
            throw new Error('Directory listing not available');
        }
        const html = await response.text();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const links = doc.getElementsByTagName('a');
        
        fileList = [];
        for (let link of links) {
            const href = link.getAttribute('href');
            if (href && (href.endsWith('.zip') || href.endsWith('.xml'))) {
                // Decode URI component (e.g. %20, japanese names)
                const filename = decodeURIComponent(href).split('/').pop();
                if (filename && filename !== 'sample_ochiai.xml') {
                    fileList.push({ name: filename, url: './data/' + href });
                }
            }
        }
        
        renderFileList();
        
        // Auto-load first file if available
        if (fileList.length > 0) {
            loadFileFromUrl(fileList[0].url, 0);
        }
    } catch (err) {
        console.warn('Could not scan data/ directory:', err);
        // Fallback: Empty list
        fileList = [];
        renderFileList();
        
        // Append a warning hint
        const liHint = document.createElement('li');
        liHint.className = 'loading';
        liHint.style.fontSize = '9px';
        liHint.textContent = '※ data/ 内の自動検知にはディレクトリ一覧表示に対応したサーバーが必要です。ファイル選択からZIP/XMLを直接アップロードできます。';
        serverFileList.appendChild(liHint);
    }
}

function renderFileList() {
    serverFileList.innerHTML = '';
    if (fileList.length === 0) {
        serverFileList.innerHTML = '<li class="loading">検出されませんでした</li>';
        return;
    }
    fileList.forEach((file, index) => {
        const li = document.createElement('li');
        li.textContent = file.name;
        if (index === activeFileIndex) li.className = 'active';
        li.addEventListener('click', () => loadFileFromUrl(file.url, index));
        serverFileList.appendChild(li);
    });
}

// 2. File Loading & Zip Parsing (Browser-side using JSZip)
async function loadFileFromUrl(url, index) {
    try {
        activeFileIndex = index;
        renderFileList();
        
        showLoading('読込中...');
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to fetch ${url}`);
        
        const blob = await response.blob();
        const file = new File([blob], url.split('/').pop());
        await processFile(file);
    } catch (err) {
        console.error(err);
        mapTitle.textContent = '読み込み失敗';
        alert('ファイルの読み込みに失敗しました: ' + err.message);
        hideLoading();
    }
}

async function processFile(file) {
    parcels = [];
    selectedParcelId = null;
    hoveredParcelId = null;
    
    try {
        if (file.name.endsWith('.zip')) {
            showLoading('ZIP展開中...');
            const zip = await JSZip.loadAsync(file);
            // Search for XML files inside ZIP (handles nested ZIPs)
            await parseZipContents(zip);
        } else if (file.name.endsWith('.xml')) {
            currentZipXmls = [];
            mapSheetSelectContainer.style.display = 'none';
            showLoading('XMLパース中...');
            const text = await file.text();
            
            // Allow UI to update loading overlay before blocking parsing logic
            setTimeout(() => {
                try {
                    parseMojXml(text);
                } catch (err) {
                    alert('XMLパースエラー: ' + err.message);
                    hideLoading();
                }
            }, 50);
        } else {
            throw new Error('対応していないファイル形式です (.zip または .xml のみ)');
        }
    } catch (err) {
        console.error(err);
        alert('ファイル処理エラー: ' + err.message);
        mapTitle.textContent = 'エラーが発生しました';
        hideLoading();
    }
}

// Recursively search zip for XML files
async function parseZipContents(zip) {
    let xmlFiles = [];
    
    // Find all files in ZIP
    for (let filename of Object.keys(zip.files)) {
        if (filename.endsWith('.xml')) {
            xmlFiles.push({ name: filename, file: zip.files[filename] });
        } else if (filename.endsWith('.zip')) {
            // Nested ZIP
            const nestedZipBlob = await zip.files[filename].async('blob');
            const nestedZip = await JSZip.loadAsync(nestedZipBlob);
            for (let nestedFilename of Object.keys(nestedZip.files)) {
                if (nestedFilename.endsWith('.xml')) {
                    xmlFiles.push({ name: nestedFilename, file: nestedZip.files[nestedFilename] });
                }
            }
        }
    }
    
    if (xmlFiles.length === 0) {
        throw new Error('ZIPファイル内に地図XMLファイルが見つかりませんでした。');
    }
    
    showLoading('地域名を読み込み中...');
    
    // Read names of all map sheets in parallel to boost speed
    const promises = xmlFiles.map(async (fileEntry) => {
        const xmlText = await fileEntry.file.async('text');
        
        // Fast regex to extract region/map name
        const mapNameMatch = xmlText.match(/<(?:[a-zA-Z0-9_]+:)?地図名>(.*?)<\/(?:[a-zA-Z0-9_]+:)?地図名>/);
        const mapName = mapNameMatch ? mapNameMatch[1] : '不明な地域';
        
        const baseName = fileEntry.name.split('/').pop().replace('.xml', '');
        
        return {
            name: `${mapName} (${baseName})`,
            file: fileEntry.file
            // text is not kept in memory to save RAM
        };
    });
    
    currentZipXmls = await Promise.all(promises);
    
    // Clear and build the dropdown selector
    mapSheetSelect.innerHTML = '';
    currentZipXmls.forEach((item, index) => {
        const option = document.createElement('option');
        option.value = index;
        option.textContent = item.name;
        mapSheetSelect.appendChild(option);
    });
    
    // Display the selector if there are multiple maps in the ZIP
    if (currentZipXmls.length > 1) {
        mapSheetSelectContainer.style.display = 'block';
        mapSheetSelect.value = 0;
    } else {
        mapSheetSelectContainer.style.display = 'none';
    }
    
    // Load the first map sheet initially
    showLoading('XML展開＆パース中...');
    setTimeout(async () => {
        try {
            const xmlText = await currentZipXmls[0].file.async('text');
            currentZipXmls[0].text = xmlText; // Cache first map
            parseMojXml(xmlText);
        } catch (err) {
            alert('XMLパースエラー: ' + err.message);
            hideLoading();
        }
    }, 50);
}

// 3. XML Parsing Logic (DOMParser)
function parseMojXml(xmlText) {
    const parser = new DOMParser();
    const xmlDoc = parser.parseFromString(xmlText, 'application/xml');
    
    // Check for XML parsing error
    const parserError = xmlDoc.getElementsByTagName('parsererror')[0];
    if (parserError) {
        throw new Error('XML構文エラー: ' + parserError.textContent);
    }
    
    // Metadata extraction
    const mapNameEl = xmlDoc.getElementsByTagNameNS('*', '地図名')[0] || xmlDoc.getElementsByTagName('地図名')[0];
    const cityCodeEl = xmlDoc.getElementsByTagNameNS('*', '市区町村コード')[0] || xmlDoc.getElementsByTagName('市区町村コード')[0];
    const cityNameEl = xmlDoc.getElementsByTagNameNS('*', '市区町村名')[0] || xmlDoc.getElementsByTagName('市区町村名')[0];
    const crsEl = xmlDoc.getElementsByTagNameNS('*', '座標系')[0] || xmlDoc.getElementsByTagName('座標系')[0];
    
    const mapName = mapNameEl ? mapNameEl.textContent : '不明な地図';
    const cityCode = cityCodeEl ? cityCodeEl.textContent : '';
    const cityName = cityNameEl ? cityNameEl.textContent : '';
    const crsName = crsEl ? crsEl.textContent : '任意座標系';
    
    mapTitle.textContent = mapName;
    metaCrs.textContent = '座標系: ' + crsName;
    metaCity.textContent = '市区町村: ' + cityName + (cityCode ? ` (${cityCode})` : '');
    
    // 1. Extract Points (GM_Point)
    const points = {};
    const pointElements = xmlDoc.getElementsByTagNameNS('*', 'GM_Point');
    for (let i = 0; i < pointElements.length; i++) {
        const pt = pointElements[i];
        const id = pt.getAttribute('id');
        const xEl = pt.getElementsByTagNameNS('*', 'X')[0];
        const yEl = pt.getElementsByTagNameNS('*', 'Y')[0];
        if (id && xEl && yEl) {
            points[id] = {
                x: parseFloat(xEl.textContent),
                y: parseFloat(yEl.textContent)
            };
        }
    }
    
    // 2. Extract Curves/Lines (GM_Curve)
    const curves = {};
    const curveElements = xmlDoc.getElementsByTagNameNS('*', 'GM_Curve');
    for (let i = 0; i < curveElements.length; i++) {
        const cv = curveElements[i];
        const id = cv.getAttribute('id');
        curves[id] = [];
        
        // Get all column/point references in standard order
        let columns = cv.getElementsByTagNameNS('*', 'GM_PointArray.column');
        if (columns.length === 0) {
            columns = cv.getElementsByTagNameNS('*', 'column');
        }
        for (let j = 0; j < columns.length; j++) {
            const col = columns[j];
            const indirect = col.getElementsByTagNameNS('*', 'GM_PointRef.point')[0] || col.getElementsByTagNameNS('*', 'point')[0];
            if (indirect) {
                const idref = indirect.getAttribute('idref');
                if (idref && points[idref]) {
                    curves[id].push(points[idref]);
                }
            } else {
                const direct = col.getElementsByTagNameNS('*', 'GM_Position.direct')[0] || col.getElementsByTagNameNS('*', 'direct')[0];
                if (direct) {
                    const xEl = direct.getElementsByTagNameNS('*', 'X')[0];
                    const yEl = direct.getElementsByTagNameNS('*', 'Y')[0];
                    if (xEl && yEl) {
                        curves[id].push({
                            x: parseFloat(xEl.textContent),
                            y: parseFloat(yEl.textContent)
                        });
                    }
                }
            }
        }
    }
    
    // 3. Extract Surfaces (GM_Surface)
    const surfaces = {};
    const surfaceElements = xmlDoc.getElementsByTagNameNS('*', 'GM_Surface');
    for (let i = 0; i < surfaceElements.length; i++) {
        const sf = surfaceElements[i];
        const id = sf.getAttribute('id');
        
        // Exterior Boundary
        const exteriorRing = sf.getElementsByTagNameNS('*', 'GM_SurfaceBoundary.exterior')[0] || sf.getElementsByTagNameNS('*', 'exterior')[0];
        const exteriorCoords = [];
        if (exteriorRing) {
            let generators = exteriorRing.getElementsByTagNameNS('*', 'GM_CompositeCurve.generator');
            if (generators.length === 0) {
                generators = exteriorRing.getElementsByTagNameNS('*', 'generator');
            }
            for (let j = 0; j < generators.length; j++) {
                const idref = generators[j].getAttribute('idref');
                if (idref && curves[idref]) {
                    exteriorCoords.push(...curves[idref]);
                }
            }
        }
        
        // Interior Boundaries (Holes)
        const interiorCoordsList = [];
        let interiorRings = sf.getElementsByTagNameNS('*', 'GM_SurfaceBoundary.interior');
        if (interiorRings.length === 0) {
            interiorRings = sf.getElementsByTagNameNS('*', 'interior');
        }
        for (let j = 0; j < interiorRings.length; j++) {
            const coords = [];
            let generators = interiorRings[j].getElementsByTagNameNS('*', 'GM_CompositeCurve.generator');
            if (generators.length === 0) {
                generators = interiorRings[j].getElementsByTagNameNS('*', 'generator');
            }
            for (let k = 0; k < generators.length; k++) {
                const idref = generators[k].getAttribute('idref');
                if (idref && curves[idref]) {
                    coords.push(...curves[idref]);
                }
            }
            if (coords.length > 0) {
                interiorCoordsList.push(coords);
            }
        }
        
        const cleanExterior = cleanDuplicates(exteriorCoords);
        let minX = Infinity, maxX = -Infinity;
        let minY = Infinity, maxY = -Infinity;
        cleanExterior.forEach(pt => {
            if (pt.x < minX) minX = pt.x;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.y > maxY) maxY = pt.y;
        });

        surfaces[id] = {
            exterior: cleanExterior,
            interiors: interiorCoordsList.map(cleanDuplicates),
            bbox: { minX, maxX, minY, maxY }
        };
    }
    
    // Remove duplicate sequential points in paths
    function cleanDuplicates(arr) {
        return arr.filter((pt, index) => {
            if (index === 0) return true;
            const prev = arr[index - 1];
            return Math.abs(pt.x - prev.x) > 1e-7 || Math.abs(pt.y - prev.y) > 1e-7;
        });
    }
    
    // 4. Extract Parcels (筆)
    const fudeElements = xmlDoc.getElementsByTagNameNS('*', '筆') || xmlDoc.getElementsByTagName('筆');
    const tempParcels = [];
    
    for (let i = 0; i < fudeElements.length; i++) {
        const fude = fudeElements[i];
        const id = fude.getAttribute('id');
        
        let chiban = '地番不明';
        let shapeRef = null;
        let scale = '--';
        let accuracy = '--';
        let typeValue = '--';
        let chome = '';
        
        // 追加のメタデータ
        let ooaza = '';
        let ooazaCode = '';
        let chomeCode = '';
        let koaza = '';
        let koazaCode = '';
        let choban = '';
        let hikaiMitei = 'false';
        let chibanAreaCode = '';
        
        // 筆ノードの直下の子要素のみを巡回して取得（getElementsByTagNameNSによる毎回の子要素ツリー全体探索を防ぎ高速化）
        let child = fude.firstElementChild;
        while (child) {
            const localName = child.localName;
            if (localName === '地番') {
                chiban = child.textContent;
            } else if (localName === '形状') {
                shapeRef = child.getAttribute('idref');
            } else if (localName === '縮尺分母') {
                scale = child.textContent;
            } else if (localName === '精度区分') {
                accuracy = child.textContent;
            } else if (localName === '座標値種別') {
                typeValue = child.textContent;
            } else if (localName === '丁目名') {
                chome = child.textContent.trim();
            } else if (localName === '大字名') {
                ooaza = child.textContent.trim();
            } else if (localName === '大字コード') {
                ooazaCode = child.textContent.trim();
            } else if (localName === '丁目コード') {
                chomeCode = child.textContent.trim();
            } else if (localName === '小字名') {
                koaza = child.textContent.trim();
            } else if (localName === '小字コード') {
                koazaCode = child.textContent.trim();
            } else if (localName === '丁番') {
                choban = child.textContent.trim();
            } else if (localName === '筆界未定区分' || localName === '筆界未定') {
                hikaiMitei = child.textContent.trim();
            } else if (localName === '地番区域コード') {
                chibanAreaCode = child.textContent.trim();
            }
            child = child.nextElementSibling;
        }
        
        if (shapeRef && surfaces[shapeRef]) {
            if (!chome) {
                // 地番から丁目を抽出
                const match = chiban.match(/(一|二|三|四|五|六|七|八|九|十|\d)丁目/);
                chome = match ? match[0] : 'その他';
            }
            
            // Precompute centroid
            const geom = surfaces[shapeRef];
            let sumX = 0, sumY = 0;
            geom.exterior.forEach(pt => {
                sumX += pt.x;
                sumY += pt.y;
            });
            const centroidX = sumX / geom.exterior.length;
            const centroidY = sumY / geom.exterior.length;
            
            tempParcels.push({
                id: id || `F-${i}`,
                chiban: chiban,
                scale: scale,
                accuracy: accuracy,
                type: typeValue,
                chome: chome,
                geometry: geom,
                centroid: { x: centroidX, y: centroidY },
                ooaza: ooaza,
                ooazaCode: ooazaCode,
                chomeCode: chomeCode,
                koaza: koaza,
                koazaCode: koazaCode,
                choban: choban,
                hikaiMitei: hikaiMitei,
                chibanAreaCode: chibanAreaCode
            });
        }
    }
    
    parcels = tempParcels;
    
    // Set scale metadata on header if available
    const scaleList = parcels.map(p => p.scale).filter(s => s !== '--');
    if (scaleList.length > 0) {
        metaScale.textContent = '縮尺分母: 1/' + scaleList[0];
    } else {
        metaScale.textContent = '縮尺分母: --';
    }
    
    // Calculate global bounding box
    calculateBounds();
    
    // Reset viewport zoom to fit
    resetView();
    
    // Render the parcel list
    renderParcelList();
    
    // Build Chome Legend
    buildLegend();
    
    // Redraw map
    drawMap();
    
    // Hide loading screen
    hideLoading();
}

// Calculate the bounding box containing all shapes
function calculateBounds() {
    let minX = Infinity, maxX = -Infinity;
    let minY = Infinity, maxY = -Infinity;
    
    parcels.forEach(p => {
        const bbox = p.geometry.bbox;
        if (bbox) {
            if (bbox.minX < minX) minX = bbox.minX;
            if (bbox.maxX > maxX) maxX = bbox.maxX;
            if (bbox.minY < minY) minY = bbox.minY;
            if (bbox.maxY > maxY) maxY = bbox.maxY;
        }
    });
    
    if (minX === Infinity) {
        bounds = { minX: 0, maxX: 100, minY: 0, maxY: 100 };
    } else {
        bounds = { minX, maxX, minY, maxY };
    }
}

// 4. Viewport Fitting (Zoom to Bounds)
function resetView() {
    if (parcels.length === 0) return;
    
    const width_xml = bounds.maxY - bounds.minY; // Spatial Y corresponds to screen X
    const height_xml = bounds.maxX - bounds.minX; // Spatial X corresponds to screen Y
    
    const pad = 30; // Screen padding pixels
    const canvasW = mapCanvas.width;
    const canvasH = mapCanvas.height;
    
    const scaleX = (canvasW - pad * 2) / width_xml;
    const scaleY = (canvasH - pad * 2) / height_xml;
    
    const scale = Math.min(scaleX, scaleY);
    
    viewState.zoom = scale;
    viewState.offsetX = (canvasW - width_xml * scale) / 2;
    viewState.offsetY = (canvasH - height_xml * scale) / 2;
    
    updateStatusScale();
    drawMap();
}

function updateStatusScale() {
    statusScale.textContent = `倍率: ${Math.round(viewState.zoom * 100)}%`;
}

// 5. Canvas Vector Rendering
function drawMap() {
    ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
    const isPrint = document.body.classList.contains('print-mode');
    
    if (isPrint) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, mapCanvas.width, mapCanvas.height);
    }
    
    if (parcels.length === 0) {
        ctx.fillStyle = isPrint ? '#64748b' : '#94a3b8';
        ctx.font = '14px Outfit';
        ctx.textAlign = 'center';
        ctx.fillText('XMLデータを読み込んでください', mapCanvas.width / 2, mapCanvas.height / 2);
        return;
    }
    
    // Draw grid background (optional but matches rich aesthetics)
    drawGrid();
    
    // Draw all parcels
    parcels.forEach(p => {
        const isSelected = p.id === selectedParcelId;
        const isHovered = p.id === hoveredParcelId;
        
        // Frustum culling check
        const bbox = p.geometry.bbox;
        if (bbox && !isSelected && !isHovered) {
            const minX_screen = (bbox.minY - bounds.minY) * viewState.zoom + viewState.offsetX;
            const maxX_screen = (bbox.maxY - bounds.minY) * viewState.zoom + viewState.offsetX;
            const minY_screen = (bounds.maxX - bbox.maxX) * viewState.zoom + viewState.offsetY;
            const maxY_screen = (bounds.maxX - bbox.minX) * viewState.zoom + viewState.offsetY;
            
            if (maxX_screen < 0 || minX_screen > mapCanvas.width || maxY_screen < 0 || minY_screen > mapCanvas.height) {
                return; // Off-screen, skip drawing this parcel
            }
        }
        
        ctx.beginPath();
        p.geometry.exterior.forEach((pt, index) => {
            const sx = (pt.y - bounds.minY) * viewState.zoom + viewState.offsetX;
            const sy = (bounds.maxX - pt.x) * viewState.zoom + viewState.offsetY;
            if (index === 0) {
                ctx.moveTo(sx, sy);
            } else {
                ctx.lineTo(sx, sy);
            }
        });
        ctx.closePath();
        
        // Set parcel fill/stroke color based on state and Chome
        const chomeColor = getChomeColor(p.chome);
        const isDimmed = activeLegendChome && p.chome !== activeLegendChome;
        
        if (isSelected) {
            ctx.fillStyle = isPrint ? 'rgba(37, 99, 235, 0.25)' : 'rgba(59, 130, 246, 0.45)';
            ctx.strokeStyle = isPrint ? '#1d4ed8' : '#60a5fa';
            ctx.lineWidth = 2.5;
        } else if (isHovered) {
            ctx.fillStyle = chomeColor.fill.replace('0.25', '0.4').replace('0.15', '0.3');
            ctx.strokeStyle = chomeColor.stroke;
            ctx.lineWidth = 2.0;
        } else {
            if (isDimmed) {
                ctx.fillStyle = isPrint ? 'rgba(241, 245, 249, 0.3)' : 'rgba(30, 41, 59, 0.05)';
                ctx.strokeStyle = isPrint ? 'rgba(203, 213, 225, 0.2)' : 'rgba(71, 85, 105, 0.1)';
                ctx.lineWidth = 0.5;
            } else {
                ctx.fillStyle = chomeColor.fill;
                ctx.strokeStyle = chomeColor.stroke;
                ctx.lineWidth = 1.0;
            }
        }
        ctx.fill();
        ctx.stroke();
    });
    
    // Draw lot numbers (地番) labels on top of parcels
    // Draw only if zoom level is reasonably large so text doesn't clutter
    if (viewState.zoom > 0.3) {
        ctx.fillStyle = isPrint ? '#334155' : '#cbd5e1';
        ctx.font = '10px Noto Sans JP, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        
        parcels.forEach(p => {
            const sx = (p.centroid.y - bounds.minY) * viewState.zoom + viewState.offsetX;
            const sy = (bounds.maxX - p.centroid.x) * viewState.zoom + viewState.offsetY;
            
            // Draw text if inside canvas bounds
            if (sx > 0 && sx < mapCanvas.width && sy > 0 && sy < mapCanvas.height) {
                // Shorten text if too long (e.g. "下落合三丁目101-1" -> "101-1")
                const match = p.chiban.match(/\d+-\d+|\d+/);
                const shortChiban = match ? match[0] : p.chiban;
                ctx.fillText(shortChiban, sx, sy);
            }
        });
    }
}

// Background grid coordinates helper
function drawGrid() {
    const isPrint = document.body.classList.contains('print-mode');
    ctx.strokeStyle = isPrint ? 'rgba(15, 23, 42, 0.06)' : 'rgba(30, 41, 59, 0.3)';
    ctx.lineWidth = 0.5;
    
    const step = 50 * viewState.zoom; // grid line every 50 meters (scaled)
    if (step < 10) return; // avoid drawing infinite dense grid lines
    
    // Grid lines along X
    const startX = viewState.offsetX % step;
    for (let x = startX; x < mapCanvas.width; x += step) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapCanvas.height);
        ctx.stroke();
    }
    
    // Grid lines along Y
    const startY = viewState.offsetY % step;
    for (let y = startY; y < mapCanvas.height; y += step) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapCanvas.width, y);
        ctx.stroke();
    }
}

// 6. Sidebar List Rendering
function renderParcelList() {
    parcelList.innerHTML = '';
    
    const filteredParcels = searchInput.value.trim() 
        ? parcels.filter(p => p.chiban.includes(searchInput.value.trim()))
        : parcels;
        
    parcelCountBadge.textContent = filteredParcels.length;
    
    if (filteredParcels.length === 0) {
        parcelList.innerHTML = '<li class="empty-msg">地番が見つかりません</li>';
        return;
    }
    
    const fragment = document.createDocumentFragment();
    
    filteredParcels.forEach(p => {
        const li = document.createElement('li');
        li.dataset.id = p.id;
        if (p.id === selectedParcelId) li.className = 'selected';
        
        li.innerHTML = `
            <span class="chiban">${p.chiban}</span>
            <span class="meta">
                <span>精度: ${p.accuracy}</span>
                <span>測量種別: ${p.type}</span>
            </span>
        `;
        
        li.addEventListener('click', () => {
            selectParcel(p.id, true);
        });
        
        li.addEventListener('mouseenter', () => {
            hoveredParcelId = p.id;
            drawMap();
        });
        
        li.addEventListener('mouseleave', () => {
            hoveredParcelId = null;
            drawMap();
        });
        
        fragment.appendChild(li);
    });
    
    parcelList.appendChild(fragment);
}

// Selection handling
function selectParcel(id, zoomTo = false) {
    selectedParcelId = id;
    hoveredParcelId = null;
    
    // Sync list active state
    Array.from(parcelList.children).forEach(li => {
        if (li.dataset.id === id) {
            li.classList.add('selected');
            li.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        } else {
            li.classList.remove('selected');
        }
    });
    
    const p = parcels.find(item => item.id === id);
    if (p) {
        statusHovered.textContent = '選択中: ' + p.chiban;
        updateDetailPanel(p);
        
        if (zoomTo) {
            // Set scale to a reasonable zoomed-in view
            viewState.zoom = Math.max(viewState.zoom, 2.5); // Ensure zoomed in
            viewState.offsetX = mapCanvas.width / 2 - (p.centroid.y - bounds.minY) * viewState.zoom;
            viewState.offsetY = mapCanvas.height / 2 - (bounds.maxX - p.centroid.x) * viewState.zoom;
            updateStatusScale();
        }
    } else {
        statusHovered.textContent = '選択中: なし';
        updateDetailPanel(null);
    }
    
    drawMap();
}

// 7. Mouse/Touch interactions for Zoom & Pan
function setupInteractionEvents() {
    viewportContainer.addEventListener('mousedown', e => {
        viewState.isDragging = true;
        viewState.startX = e.clientX;
        viewState.startY = e.clientY;
        viewportContainer.style.cursor = 'grabbing';
    });
    
    window.addEventListener('mouseup', () => {
        if (viewState.isDragging) {
            viewState.isDragging = false;
            viewportContainer.style.cursor = 'grab';
        }
    });
    
    viewportContainer.addEventListener('mousemove', e => {
        // Handle drag panning
        if (viewState.isDragging) {
            const dx = e.clientX - viewState.startX;
            const dy = e.clientY - viewState.startY;
            viewState.offsetX += dx;
            viewState.offsetY += dy;
            viewState.startX = e.clientX;
            viewState.startY = e.clientY;
            drawMap();
            return;
        }
        
        // Handle coordinates and hover details
        const rect = mapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        // Convert screen coordinate to XML spatial coordinate
        const spatialY = (mx - viewState.offsetX) / viewState.zoom + bounds.minY;
        const spatialX = bounds.maxX - (my - viewState.offsetY) / viewState.zoom;
        
        statusCoords.textContent = `X: ${spatialX.toFixed(3)}, Y: ${spatialY.toFixed(3)}`;
        
        // Find parcel under mouse
        const pUnderMouse = findParcelAt(spatialX, spatialY);
        if (pUnderMouse) {
            if (hoveredParcelId !== pUnderMouse.id) {
                hoveredParcelId = pUnderMouse.id;
                viewportContainer.style.cursor = 'pointer';
                
                // Show tooltip
                hoverTooltip.innerHTML = `
                    <strong>地番: ${pUnderMouse.chiban}</strong><br>
                    精度: ${pUnderMouse.accuracy}<br>
                    測地: ${pUnderMouse.type}
                `;
                hoverTooltip.style.left = (mx + 15) + 'px';
                hoverTooltip.style.top = (my + 15) + 'px';
                hoverTooltip.style.display = 'block';
                drawMap();
            } else {
                // Just move tooltip
                hoverTooltip.style.left = (mx + 15) + 'px';
                hoverTooltip.style.top = (my + 15) + 'px';
            }
        } else {
            if (hoveredParcelId !== null) {
                hoveredParcelId = null;
                viewportContainer.style.cursor = 'grab';
                hoverTooltip.style.display = 'none';
                drawMap();
            }
        }
    });
    
    // Zoom centered on cursor position (mouse wheel)
    viewportContainer.addEventListener('wheel', e => {
        e.preventDefault();
        
        const rect = mapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        // Zoom factors
        const zoomFactor = e.deltaY < 0 ? 1.15 : 0.85;
        const oldZoom = viewState.zoom;
        const newZoom = Math.max(0.01, Math.min(100, oldZoom * zoomFactor));
        
        // Adjust offsets to keep mouse point anchored in spatial coords
        viewState.offsetX = mx - (mx - viewState.offsetX) * (newZoom / oldZoom);
        viewState.offsetY = my - (my - viewState.offsetY) * (newZoom / oldZoom);
        viewState.zoom = newZoom;
        
        updateStatusScale();
        drawMap();
    }, { passive: false });
    
    // Click to select
    viewportContainer.addEventListener('click', e => {
        if (e.target.tagName === 'BUTTON') return; // Ignore click on controls overlay
        
        const rect = mapCanvas.getBoundingClientRect();
        const mx = e.clientX - rect.left;
        const my = e.clientY - rect.top;
        
        // Convert screen coordinate to XML spatial coordinate
        const spatialY = (mx - viewState.offsetX) / viewState.zoom + bounds.minY;
        const spatialX = bounds.maxX - (my - viewState.offsetY) / viewState.zoom;
        
        const pUnderMouse = findParcelAt(spatialX, spatialY);
        if (pUnderMouse) {
            selectParcel(pUnderMouse.id);
        } else {
            selectedParcelId = null;
            statusHovered.textContent = '選択中: なし';
            drawMap();
            
            // Clear list active state
            Array.from(parcelList.children).forEach(li => li.classList.remove('selected'));
            
            // Clear detail panel
            updateDetailPanel(null);
        }
    });
    
    // Navigation controls
    resetViewBtn.addEventListener('click', resetView);
    resetViewBtnOverlay.addEventListener('click', resetView);
    
    zoomInBtn.addEventListener('click', () => {
        const oldZoom = viewState.zoom;
        viewState.zoom = Math.min(100, oldZoom * 1.3);
        viewState.offsetX = mapCanvas.width / 2 - (mapCanvas.width / 2 - viewState.offsetX) * (viewState.zoom / oldZoom);
        viewState.offsetY = mapCanvas.height / 2 - (mapCanvas.height / 2 - viewState.offsetY) * (viewState.zoom / oldZoom);
        updateStatusScale();
        drawMap();
    });
    
    zoomOutBtn.addEventListener('click', () => {
        const oldZoom = viewState.zoom;
        viewState.zoom = Math.max(0.01, oldZoom * 0.7);
        viewState.offsetX = mapCanvas.width / 2 - (mapCanvas.width / 2 - viewState.offsetX) * (viewState.zoom / oldZoom);
        viewState.offsetY = mapCanvas.height / 2 - (mapCanvas.height / 2 - viewState.offsetY) * (viewState.zoom / oldZoom);
        updateStatusScale();
        drawMap();
    });
}

// Ray-casting point-in-polygon algorithm
function findParcelAt(x, y) {
    // Traverse backwards so top/later items are prioritized
    for (let i = parcels.length - 1; i >= 0; i--) {
        const p = parcels[i];
        const bbox = p.geometry.bbox;
        
        // Fast AABB bounding box pre-filter
        if (bbox && (x < bbox.minX || x > bbox.maxX || y < bbox.minY || y > bbox.maxY)) {
            continue;
        }
        
        if (isPointInPolygon({ x, y }, p.geometry.exterior)) {
            // Also check that it's not inside any interior hole
            let insideHole = false;
            for (let hole of p.geometry.interiors) {
                if (isPointInPolygon({ x, y }, hole)) {
                    insideHole = true;
                    break;
                }
            }
            if (!insideHole) return p;
        }
    }
    return null;
}

function isPointInPolygon(pt, poly) {
    let x = pt.x, y = pt.y;
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
        let xi = poly[i].x, yi = poly[i].y;
        let xj = poly[j].x, yj = poly[j].y;
        let intersect = ((yi > y) !== (yj > y))
            && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
        if (intersect) inside = !inside;
    }
    return inside;
}

// 8. File Pickers / Drop zone setup
function setupFileEvents() {
    // Clicking drag and drop opens file picker
    dropZone.addEventListener('click', () => {
        fileInput.click();
    });
    
    fileInput.addEventListener('change', e => {
        if (e.target.files.length > 0) {
            processFile(e.target.files[0]);
        }
    });
    
    // Drag events
    dropZone.addEventListener('dragover', e => {
        e.preventDefault();
        dropZone.classList.add('dragover');
    });
    
    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('dragover');
    });
    
    dropZone.addEventListener('drop', e => {
        e.preventDefault();
        dropZone.classList.remove('dragover');
        if (e.dataTransfer.files.length > 0) {
            processFile(e.dataTransfer.files[0]);
        }
    });
}

// 9. Search Bar setup
function setupSearch() {
    let debounceTimer;
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        clearSearchBtn.style.display = query ? 'block' : 'none';
        
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            renderParcelList();
        }, 150);
    });
    
    clearSearchBtn.addEventListener('click', () => {
        searchInput.value = '';
        clearSearchBtn.style.display = 'none';
        clearTimeout(debounceTimer);
        renderParcelList();
    });
}

// 10. Chome (丁目) Legend Overlay Builder
function buildLegend() {
    legendList.innerHTML = '';
    
    // Find unique chome names
    const chomes = [...new Set(parcels.map(p => p.chome))].filter(c => c !== '--' && c !== 'その他');
    // Sort chomes logically (e.g. 一丁目, 二丁目, 三丁目...)
    const chomeOrder = ['一丁目', '1丁目', '二丁目', '2丁目', '三丁目', '3丁目', '四丁目', '4丁目', '五丁目', '5丁目', '六丁目', '6丁目'];
    chomes.sort((a, b) => {
        const idxA = chomeOrder.indexOf(a);
        const idxB = chomeOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b);
        if (idxA === -1) return 1;
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    
    // Add 'その他' to the end if present
    if (parcels.some(p => p.chome === 'その他')) {
        chomes.push('その他');
    }
    
    if (chomes.length > 1) {
        chomes.forEach(chome => {
            const li = document.createElement('li');
            li.className = 'legend-item';
            li.dataset.chome = chome;
            
            const color = getChomeColor(chome);
            
            li.innerHTML = `
                <span class="legend-color-box" style="background-color: ${color.fill}; color: ${color.stroke};"></span>
                <span>${chome}</span>
            `;
            
            // Highlight Chome on hover
            li.addEventListener('mouseenter', () => {
                activeLegendChome = chome;
                // Dim other legend items
                Array.from(legendList.children).forEach(item => {
                    if (item.dataset.chome !== chome) {
                        item.classList.add('dimmed');
                    }
                });
                drawMap();
            });
            
            li.addEventListener('mouseleave', () => {
                activeLegendChome = null;
                // Reset opacity
                Array.from(legendList.children).forEach(item => {
                    item.classList.remove('dimmed');
                });
                drawMap();
            });
            
            legendList.appendChild(li);
        });
        legendOverlay.style.display = 'block';
    } else {
        legendOverlay.style.display = 'none';
    }
}

// Predefined colors for Dark Theme
const paletteDark = [
    { fill: 'rgba(239, 68, 68, 0.25)', stroke: '#f87171' },   // Red/Coral
    { fill: 'rgba(16, 185, 129, 0.25)', stroke: '#34d399' },  // Green/Emerald
    { fill: 'rgba(59, 130, 246, 0.25)', stroke: '#60a5fa' },  // Blue/Sky
    { fill: 'rgba(168, 85, 247, 0.25)', stroke: '#c084fc' }, // Purple/Amethyst
    { fill: 'rgba(245, 158, 11, 0.25)', stroke: '#fbbf24' },  // Amber/Orange
    { fill: 'rgba(236, 72, 153, 0.25)', stroke: '#f472b6' },  // Pink
    { fill: 'rgba(6, 182, 212, 0.25)', stroke: '#22d3ee' }    // Cyan
];

// Predefined colors for Light / Print Theme (more contrast, pastel fills)
const paletteLight = [
    { fill: 'rgba(239, 68, 68, 0.12)', stroke: '#b91c1c' },   // Red
    { fill: 'rgba(16, 185, 129, 0.12)', stroke: '#047857' },  // Green
    { fill: 'rgba(59, 130, 246, 0.12)', stroke: '#1d4ed8' },  // Blue
    { fill: 'rgba(168, 85, 247, 0.12)', stroke: '#6d28d9' }, // Purple
    { fill: 'rgba(245, 158, 11, 0.12)', stroke: '#b45309' },  // Amber
    { fill: 'rgba(236, 72, 153, 0.12)', stroke: '#be185d' },  // Pink
    { fill: 'rgba(6, 182, 212, 0.12)', stroke: '#0369a1' }    // Cyan
];

const chomeColorCache = {};

function getChomeColor(chomeName) {
    const isPrint = document.body.classList.contains('print-mode');
    if (chomeName === 'その他' || chomeName === '--' || !chomeName) {
        return isPrint 
            ? { fill: 'rgba(100, 116, 139, 0.08)', stroke: '#64748b' }
            : { fill: 'rgba(71, 85, 105, 0.15)', stroke: '#475569' };
    }
    
    const cacheKey = `${chomeName}_${isPrint ? 'light' : 'dark'}`;
    if (chomeColorCache[cacheKey]) {
        return chomeColorCache[cacheKey];
    }
    
    // Assign color from palette using simple hash
    let hash = 0;
    for (let i = 0; i < chomeName.length; i++) {
        hash = chomeName.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const activePalette = isPrint ? paletteLight : paletteDark;
    const index = Math.abs(hash) % activePalette.length;
    chomeColorCache[cacheKey] = activePalette[index];
    return activePalette[index];
}

// Update the details panel on the sidebar
function updateDetailPanel(parcel) {
    const container = document.getElementById('detailContent');
    if (!container) return;
    
    if (!parcel) {
        container.innerHTML = '<p class="empty-msg" style="padding: 10px 0;">筆を選択すると詳細情報が表示されます</p>';
        return;
    }
    
    const isPublicCrs = !metaCrs.textContent.includes('任意座標系');
    const areaVal = calculateArea(parcel.geometry.exterior);
    const areaStr = areaVal > 0 
        ? (areaVal.toFixed(2) + (isPublicCrs ? ' ㎡' : ' (任意単位)'))
        : '--';
        
    let html = `
        <div class="detail-row">
            <span class="detail-label">地番</span>
            <span class="detail-value" style="color: var(--accent-color); font-size: 13px;">${parcel.chiban}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">算出面積</span>
            <span class="detail-value" style="color: var(--success-color); font-weight: bold;">${areaStr}</span>
        </div>
    `;
    
    if (parcel.ooaza) {
        html += `
            <div class="detail-row">
                <span class="detail-label">大字</span>
                <span class="detail-value">${parcel.ooaza} ${parcel.ooazaCode ? `(${parcel.ooazaCode})` : ''}</span>
            </div>
        `;
    }
    
    if (parcel.chome && parcel.chome !== 'その他' && parcel.chome !== '--') {
        html += `
            <div class="detail-row">
                <span class="detail-label">丁目</span>
                <span class="detail-value">${parcel.chome} ${parcel.chomeCode ? `(${parcel.chomeCode})` : ''}</span>
            </div>
        `;
    }
    
    if (parcel.koaza) {
        html += `
            <div class="detail-row">
                <span class="detail-label">小字</span>
                <span class="detail-value">${parcel.koaza} ${parcel.koazaCode ? `(${parcel.koazaCode})` : ''}</span>
            </div>
        `;
    }
    
    if (parcel.choban) {
        html += `
            <div class="detail-row">
                <span class="detail-label">丁番</span>
                <span class="detail-value">${parcel.choban}</span>
            </div>
        `;
    }
    
    html += `
        <div class="detail-row">
            <span class="detail-label">精度区分</span>
            <span class="detail-value">${parcel.accuracy}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">縮尺分母</span>
            <span class="detail-value">1 / ${parcel.scale}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">座標値種別</span>
            <span class="detail-value">${parcel.type}</span>
        </div>
    `;
    
    if (parcel.chibanAreaCode) {
        html += `
            <div class="detail-row">
                <span class="detail-label">地番区域コード</span>
                <span class="detail-value">${parcel.chibanAreaCode}</span>
            </div>
        `;
    }
    
    html += `
        <div class="detail-row">
            <span class="detail-label">筆界未定</span>
            <span class="detail-value" style="color: ${parcel.hikaiMitei === 'true' ? 'var(--danger-color)' : 'inherit'};">
                ${parcel.hikaiMitei === 'true' ? '⚠️ 筆界未定' : '確定'}
            </span>
        </div>
    `;
    
    container.innerHTML = html;
}

// Calculate polygon area using Shoelace formula
function calculateArea(exterior) {
    if (!exterior || exterior.length < 3) return 0;
    let area = 0;
    const n = exterior.length;
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        area += exterior[i].x * exterior[j].y;
        area -= exterior[j].x * exterior[i].y;
    }
    return Math.abs(area / 2.0);
}
