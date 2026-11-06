#!/bin/sh
# Uso: sh scripts/nuova-versione.sh 2.2.0
# Aggiorna il numero di versione in tutti gli indirizzi dei file, così i telefoni
# scaricano tutti i file nuovi insieme invece di mescolare versioni diverse.
set -e
V="$1"; [ -n "$V" ] || { echo "Indica la versione, es. 2.2.0"; exit 1; }
cd "$(dirname "$0")/.."
for f in js/*.js js/ai/*.js; do perl -pi -e "s#(from\s+'\.{1,2}/[\w/]+\.js)(\?v=[\d.]+)?'#\$1?v=$V'#g" "$f"; done
perl -pi -e "s#(src=\"js/app\.js)(\?v=[\d.]+)?\"#\$1?v=$V\"#; s#(href=\"styles\.css)(\?v=[\d.]+)?\"#\$1?v=$V\"#" index.html
perl -pi -e "s#const VERSION = '[\d.]+';#const VERSION = '$V';#" sw.js
perl -pi -e "s#versione [\d.]+<#versione $V<#" js/views.js
echo "Versione aggiornata a $V"
