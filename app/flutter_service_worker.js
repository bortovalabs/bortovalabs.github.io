'use strict';
const MANIFEST = 'flutter-app-manifest';
const TEMP = 'flutter-temp-cache';
const CACHE_NAME = 'flutter-app-cache';

const RESOURCES = {"version.json": "2951b9d2813be98960cfa9f0b1aa2cad",
"assets/shaders/ink_sparkle.frag": "ecc85a2e95f5e9f53123dcaf8cb9b6ce",
"assets/assets/fonts/Inter-Medium.otf": "d045577bcf54bb0197d8bdcc7fe3d5c7",
"assets/assets/fonts/Poppins-Regular.ttf": "c8d819519a2b353dd12fa14c39078eaa",
"assets/assets/fonts/Poppins-Medium.ttf": "3e5fef89bb37e7fe380f3170d7316acb",
"assets/assets/fonts/OFL.txt": "2680fce30f17e5fed9bcebd9336e5b78",
"assets/assets/fonts/Inter-Regular.otf": "b37fc742ffeb91d3865f1a7b0bb6b7b0",
"assets/assets/fonts/Poppins-Bold.ttf": "3bbad922bb7347b2b38956a17ea3bdaf",
"assets/assets/fonts/Inter-Bold.otf": "dcf02391c6e48c1899cb3467b0923e12",
"assets/assets/fonts/Inter-SemiBold.otf": "2e0bf4815461ede7bcd5e28275445711",
"assets/assets/brand/logo-light.svg": "112fd71ac873f94fd0aa0e9f90fc600b",
"assets/assets/brand/icon-legacy.png": "ffffcb88618f1660e2ad4aef8c021ac5",
"assets/assets/brand/icon.svg": "5a20504656c03af09a5054fa280d094e",
"assets/assets/brand/logo-dark.svg": "a46002327a06903ef171c3b9fb94dfa3",
"assets/assets/brand/icon-foreground.png": "31bed0a8d745805a4ff1e36af1417eb5",
"assets/assets/brand/icon-background.png": "9a07315bc470168ed46d9119ab6057e6",
"assets/fonts/MaterialIcons-Regular.otf": "d707a52da2649a28f1def52ad18b4fc8",
"assets/AssetManifest.bin.json": "9120af34f2bd0aeb62247bb7c5b05b02",
"assets/packages/flutter_map/lib/assets/flutter_map_logo.png": "208d63cc917af9713fc9572bd5c09362",
"assets/FontManifest.json": "5611b82a63d9d444420f3b8db4cdf3a5",
"assets/AssetManifest.bin": "0fab124349e75b592c5fdcaa131143dc",
"assets/NOTICES": "6a4a9f6117af9ff05084637681603c06",
"assets/AssetManifest.json": "5244cd884823933a779e578ff63e4f42",
"flutter.js": "83d881c1dbb6d6bcd6b42e274605b69c",
"main.dart.js": "70610263967bf4e9a577e6eb5d674a87",
"index.html": "07d06261017ccf9939bf706a39b04fe9",
"/": "07d06261017ccf9939bf706a39b04fe9",
"icons/Icon-maskable-192.png": "e79b08856f9de35a4ae124962e6fd69e",
"icons/Icon-192.png": "4198836937e18fe8fd1a0394866ede69",
"icons/Icon-maskable-512.png": "1e89937cb5b94d35356c73665cd3d942",
"icons/Icon-512.png": "55f67faf535b6ff159d28d1bbaf7fc95",
"favicon.png": "f254d48d2de46a35b00b60ec4818581a",
"flutter_bootstrap.js": "1e0c9be7ca2be88e268722d41794f1e4",
"canvaskit/canvaskit.js.symbols": "bdcd3835edf8586b6d6edfce8749fb77",
"canvaskit/canvaskit.wasm": "7a3f4ae7d65fc1de6a6e7ddd3224bc93",
"canvaskit/skwasm.js.symbols": "e72c79950c8a8483d826a7f0560573a1",
"canvaskit/skwasm.wasm": "39dd80367a4e71582d234948adc521c0",
"canvaskit/skwasm.js": "ea559890a088fe28b4ddf70e17e60052",
"canvaskit/chromium/canvaskit.js.symbols": "b61b5f4673c9698029fa0a746a9ad581",
"canvaskit/chromium/canvaskit.wasm": "f504de372e31c8031018a9ec0a9ef5f0",
"canvaskit/chromium/canvaskit.js": "8191e843020c832c9cf8852a4b909d4c",
"canvaskit/canvaskit.js": "728b2d477d9b8c14593d4f9b82b484f3",
"manifest.json": "0fac0bc524ec2bd40c722c2e260af325"};
// The application shell files that are downloaded before a service worker can
// start.
const CORE = ["main.dart.js",
"index.html",
"flutter_bootstrap.js",
"assets/AssetManifest.bin.json",
"assets/FontManifest.json"];

// During install, the TEMP cache is populated with the application shell files.
self.addEventListener("install", (event) => {
  self.skipWaiting();
  return event.waitUntil(
    caches.open(TEMP).then((cache) => {
      return cache.addAll(
        CORE.map((value) => new Request(value, {'cache': 'reload'})));
    })
  );
});
// During activate, the cache is populated with the temp files downloaded in
// install. If this service worker is upgrading from one with a saved
// MANIFEST, then use this to retain unchanged resource files.
self.addEventListener("activate", function(event) {
  return event.waitUntil(async function() {
    try {
      var contentCache = await caches.open(CACHE_NAME);
      var tempCache = await caches.open(TEMP);
      var manifestCache = await caches.open(MANIFEST);
      var manifest = await manifestCache.match('manifest');
      // When there is no prior manifest, clear the entire cache.
      if (!manifest) {
        await caches.delete(CACHE_NAME);
        contentCache = await caches.open(CACHE_NAME);
        for (var request of await tempCache.keys()) {
          var response = await tempCache.match(request);
          await contentCache.put(request, response);
        }
        await caches.delete(TEMP);
        // Save the manifest to make future upgrades efficient.
        await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
        // Claim client to enable caching on first launch
        self.clients.claim();
        return;
      }
      var oldManifest = await manifest.json();
      var origin = self.location.origin;
      for (var request of await contentCache.keys()) {
        var key = request.url.substring(origin.length + 1);
        if (key == "") {
          key = "/";
        }
        // If a resource from the old manifest is not in the new cache, or if
        // the MD5 sum has changed, delete it. Otherwise the resource is left
        // in the cache and can be reused by the new service worker.
        if (!RESOURCES[key] || RESOURCES[key] != oldManifest[key]) {
          await contentCache.delete(request);
        }
      }
      // Populate the cache with the app shell TEMP files, potentially overwriting
      // cache files preserved above.
      for (var request of await tempCache.keys()) {
        var response = await tempCache.match(request);
        await contentCache.put(request, response);
      }
      await caches.delete(TEMP);
      // Save the manifest to make future upgrades efficient.
      await manifestCache.put('manifest', new Response(JSON.stringify(RESOURCES)));
      // Claim client to enable caching on first launch
      self.clients.claim();
      return;
    } catch (err) {
      // On an unhandled exception the state of the cache cannot be guaranteed.
      console.error('Failed to upgrade service worker: ' + err);
      await caches.delete(CACHE_NAME);
      await caches.delete(TEMP);
      await caches.delete(MANIFEST);
    }
  }());
});
// The fetch handler redirects requests for RESOURCE files to the service
// worker cache.
self.addEventListener("fetch", (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  var origin = self.location.origin;
  var key = event.request.url.substring(origin.length + 1);
  // Redirect URLs to the index.html
  if (key.indexOf('?v=') != -1) {
    key = key.split('?v=')[0];
  }
  if (event.request.url == origin || event.request.url.startsWith(origin + '/#') || key == '') {
    key = '/';
  }
  // If the URL is not the RESOURCE list then return to signal that the
  // browser should take over.
  if (!RESOURCES[key]) {
    return;
  }
  // If the URL is the index.html, perform an online-first request.
  if (key == '/') {
    return onlineFirst(event);
  }
  event.respondWith(caches.open(CACHE_NAME)
    .then((cache) =>  {
      return cache.match(event.request).then((response) => {
        // Either respond with the cached resource, or perform a fetch and
        // lazily populate the cache only if the resource was successfully fetched.
        return response || fetch(event.request).then((response) => {
          if (response && Boolean(response.ok)) {
            cache.put(event.request, response.clone());
          }
          return response;
        });
      })
    })
  );
});
self.addEventListener('message', (event) => {
  // SkipWaiting can be used to immediately activate a waiting service worker.
  // This will also require a page refresh triggered by the main worker.
  if (event.data === 'skipWaiting') {
    self.skipWaiting();
    return;
  }
  if (event.data === 'downloadOffline') {
    downloadOffline();
    return;
  }
});
// Download offline will check the RESOURCES for all files not in the cache
// and populate them.
async function downloadOffline() {
  var resources = [];
  var contentCache = await caches.open(CACHE_NAME);
  var currentContent = {};
  for (var request of await contentCache.keys()) {
    var key = request.url.substring(origin.length + 1);
    if (key == "") {
      key = "/";
    }
    currentContent[key] = true;
  }
  for (var resourceKey of Object.keys(RESOURCES)) {
    if (!currentContent[resourceKey]) {
      resources.push(resourceKey);
    }
  }
  return contentCache.addAll(resources);
}
// Attempt to download the resource online before falling back to
// the offline cache.
function onlineFirst(event) {
  return event.respondWith(
    fetch(event.request).then((response) => {
      return caches.open(CACHE_NAME).then((cache) => {
        cache.put(event.request, response.clone());
        return response;
      });
    }).catch((error) => {
      return caches.open(CACHE_NAME).then((cache) => {
        return cache.match(event.request).then((response) => {
          if (response != null) {
            return response;
          }
          throw error;
        });
      });
    })
  );
}
