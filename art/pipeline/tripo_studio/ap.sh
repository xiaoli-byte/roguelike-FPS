#!/bin/bash
# ap.sh <ID> "<note>" [batch]: approve review + publish (reviewer = Claude AI visual review; user waived reviews)
cd "$(dirname "$0")/.." && python assetctl.py approve "$1" review --by "Claude AI visual review" --note "${3:-$(date +%F)}：$2；用户授权免审" 2>&1 | tail -1 && python assetctl.py publish "$1" 2>&1 | tail -1
