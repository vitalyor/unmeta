#!/usr/bin/env bash
# Downloads public real-world samples into test/samples/ (gitignored, ~210 MB). Opt-in tests use them.
#   RAW: raw.pixls.us, CC0 — https://raw.pixls.us
#   C2PA: github.com/c2pa-org/public-testfiles, CC BY-SA 4.0
set -euo pipefail
cd "$(dirname "$0")" && mkdir -p samples && cd samples
P=https://raw.pixls.us/data
C=https://raw.githubusercontent.com/c2pa-org/public-testfiles/main/legacy/1.4
while read -r name url; do
  [ -s "$name" ] || { echo "↓ $name"; curl -fsSL --retry 2 -o "$name.part" "$url" && mv "$name.part" "$name"; }
done <<EOF
iphone12pro.dng $P/Apple/iPhone%2012%20Pro/IMG_1361.DNG
pixel8pro.dng $P/Google/Pixel%208%20Pro/PXL_20240415_103400204.RAW-02.ORIGINAL.dng
canon-r5.cr3 $P/Canon/EOS%20R5/Canon_EOS_R5_CRAW_ISO_100_crop_nodual.CR3
sony-a7m5.arw $P/SONY/ILCE-7M5/apsc_compressed.ARW
nikon-z6iii.nef $P/NIKON%20CORPORATION/NIKON%20Z6_3/Nikon_Z6__3_High_Efficiency_16_9.NEF
fuji-xm5.raf $P/FUJIFILM/X-M5/DSCF0622_-_compressed.RAF
om5ii.orf $P/OM%20Digital%20Solutions/OM-5MarkII/OM_System_OM-5_2_hires_a.ORF
panasonic-g9.rw2 $P/Panasonic/DC-G9/P1000476.RW2
c2pa.jpg $C/image/jpeg/adobe-20220124-CA.jpg
c2pa.pdf $C/pdf/adobe-20240110-single_manifest_store.pdf
c2pa.mp4 $C/video/mp4/truepic-20230212-zoetrope.mp4
EOF
ls -la
