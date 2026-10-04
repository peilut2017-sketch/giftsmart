#!/usr/bin/env bash
# Builds the promo's narration track (src/promo/assets/narration.mp3) from ONE
# continuous voice recording: cuts it into its 17 phrases and places each phrase
# on its cue in the video timeline, then EQ + gentle compression + loudness to
# -14 LUFS (the Reels / TikTok / Shorts target).
#
#   scripts/promo-voice/build-narration.sh path/to/voice.mp3
#
# SRC_* = where each phrase sits in the recording (found with ffmpeg silencedetect).
# AT_*  = where it plays in the video (design seconds; same clock as src/promo).
# A new recording needs new SRC values; to retime the ad, change AT values and
# keep the captions in src/promo/config.ts in step.
set -euo pipefail
IN="${1:?usage: build-narration.sh voice.mp3}"
OUT="$(cd "$(dirname "$0")/../.." && pwd)/src/promo/assets/narration.mp3"
TOTAL=32

#          src_in  src_out  at      phrase
CUES=(
  "0.00    2.15     0.20"  # כַּמָּה גיפט קארדים יֵשׁ לְךָ עַכְשָׁיו?
  "2.58    3.39     2.45"  # וְאֵיפֹה הֵם?
  "3.67    5.18     4.75"  # הַכִּירוּ אֶת גיפט סמארט.
  "5.49    7.20     7.10"  # כָּל הַשּׁוֹבָרִים בְּמָקוֹם אֶחָד.
  "7.46    8.50     8.95"  # הַכֹּל מְסֻדָּר.
  "8.89    9.44    10.26"  # יִתְרָה.   (lands on the balance highlight)
  "9.79   10.36    10.81"  # תֹּקֶף.    (expiry highlight)
  "10.72  11.16    11.36"  # קוֹד.
  "11.59  12.68    12.16"  # עוֹמְדִים בַּקֻּפָּה?
  "13.01  14.87    14.46"  # הַשּׁוֹבָר אֶצְלְךָ, תּוֹךְ שְׁנִיָּה.
  "15.28  16.77    17.16"  # הִשְׁתַּמַּשְׁתָּ רַק בְּחֵלֶק?
  "17.14  18.41    19.36"  # הַיִּתְרָה נִשְׁאֶרֶת אִתְּךָ.
  "18.66  20.24    21.51"  # לֹא נוֹתְנִים לַכֶּסֶף לָפוּג.
  "20.56  22.89    23.21"  # תִּזְכֹּרֶת בִּזְמַן, לִפְנֵי שֶׁמְּאֻחָר.
  "23.14  24.04    25.71"  # גיפט סמארט.
  "24.28  26.79    26.81"  # כָּל הַגִּיפְט קַארְדִּים שֶׁלְּךָ, בְּמָקוֹם אֶחָד.
  "27.04  28.80    29.51"  # הַתְחִילוּ עַכְשָׁיו, בְּחִנָּם.
)

graph=""; mix=""; i=0
for cue in "${CUES[@]}"; do
  read -r a b at <<<"$cue"
  ms=$(awk "BEGIN{printf \"%d\", $at*1000}")
  fo=$(awk "BEGIN{printf \"%.3f\", ($b-$a)-0.04}")
  graph+="[0:a]atrim=$a:$b,asetpts=PTS-STARTPTS,afade=t=in:d=0.012,afade=t=out:st=$fo:d=0.04,adelay=${ms}:all=1[s$i];"
  mix+="[s$i]"; i=$((i+1))
done
graph+="${mix}amix=inputs=$i:normalize=0,apad,atrim=0:$TOTAL,highpass=f=75,equalizer=f=3200:t=q:w=1.2:g=2,acompressor=threshold=-20dB:ratio=2.5:attack=8:release=120:makeup=2,loudnorm=I=-14:TP=-1.5:LRA=7,aresample=48000[out]"

ffmpeg -v error -y -i "$IN" -filter_complex "$graph" -map "[out]" -ac 2 -c:a libmp3lame -b:a 192k "$OUT"
echo "✓ $OUT"
