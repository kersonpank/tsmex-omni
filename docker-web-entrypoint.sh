#!/bin/sh
# Debug: list served files and script src from index.html (runtime evidence)
echo "[TSM-WEB] Listing /usr/share/nginx/html:"
ls -la /usr/share/nginx/html/ 2>&1 || true
echo "[TSM-WEB] Listing /usr/share/nginx/html/assets:"
ls -la /usr/share/nginx/html/assets/ 2>&1 || true
echo "[TSM-WEB] Script src in index.html:"
grep -o 'src="[^"]*"' /usr/share/nginx/html/index.html 2>&1 || true
exec nginx -g "daemon off;"
