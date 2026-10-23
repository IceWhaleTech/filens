-- Regenerate on macOS with Keynote installed:
-- osascript scripts/generate-keynote-sample.applescript /tmp/filens-weekend.key /absolute/path/to/samples/showcase
on putText(targetSlide, copyText, px, py, pw, ph, fontSize, rgbColor)
  tell application "Keynote"
    tell targetSlide
      set itemRef to make new text item with properties {object text:copyText, position:{px, py}, width:pw, height:ph}
      tell object text of itemRef
        set font to "Helvetica Neue"
        set size to fontSize
      end tell
      set color of object text of itemRef to rgbColor
    end tell
  end tell
end putText

on putImage(targetSlide, imagePath, px, py, pw, ph)
  set imageFile to POSIX file imagePath
  tell application "Keynote" to tell targetSlide to make new image with properties {file:imageFile, position:{px, py}, width:pw, height:ph}
end putImage

on run argv
  set outputFile to POSIX file (item 1 of argv)
  set assetRoot to item 2 of argv
  set white to {65535, 65535, 65535}
  set blue to {4626, 36237, 65535}
  set ice to {54998, 61166, 65535}
  set muted to {32639, 44461, 56026}
  tell application "Keynote"
    set docRef to make new document with properties {document theme:theme 1, width:1200, height:675}
    tell docRef
      try
        set emptyLayout to first slide layout whose name is "空白"
      on error
        set emptyLayout to last slide layout
      end try
      set s1 to slide 1
      set base slide of s1 to emptyLayout
      set title showing of s1 to false
      set body showing of s1 to false
      set s2 to make new slide with properties {base slide:emptyLayout}
      set s3 to make new slide with properties {base slide:emptyLayout}
      repeat with s in {s1, s2, s3}
        set presenter notes of s to "Original public showcase. Photo sources and color grading are documented in samples/SOURCES.md."
      end repeat
    end tell
  end tell
  repeat with s in {s1, s2, s3}
    my putImage(s, assetRoot & "/midnight.png", 0, 0, 1200, 675)
  end repeat
  my putImage(s1, assetRoot & "/aurora-portrait.jpg", 480, 0, 720, 675)
  my putText(s1, "FIELD NOTES / THE NIGHT ISSUE", 48, 46, 700, 30, 13, blue)
  my putText(s1, "BEYOND", 43, 174, 800, 115, 91, white)
  my putText(s1, "THE VISIBLE.", 45, 282, 850, 100, 68, white)
  my putText(s1, "Follow the light.", 50, 455, 420, 45, 25, ice)
  my putText(s1, "A journey into the extraordinary.", 50, 505, 420, 45, 17, muted)
  my putText(s1, "POLAR SKIES / DEEP SPACE / NEW PERSPECTIVES", 50, 605, 1000, 30, 11, muted)
  my putText(s1, "filens / 01", 50, 641, 400, 25, 11, muted)
  my putImage(s2, assetRoot & "/aurora-banner.jpg", 0, 0, 1200, 540)
  my putText(s2, "02 / AT THE EDGE OF NIGHT", 48, 40, 1000, 35, 13, ice)
  my putText(s2, "CHASE THE LIGHT.", 48, 555, 1100, 72, 49, white)
  my putText(s2, "Photograph: Carsten / CC BY 2.0 / pale-blue color grade", 50, 640, 1100, 25, 11, muted)
  my putImage(s3, assetRoot & "/cosmic-cliffs-square.jpg", 600, 0, 600, 675)
  my putText(s3, "03 / THE COSMIC ATLAS", 48, 46, 700, 30, 13, blue)
  my putText(s3, "A universe" & return & "of detail.", 45, 170, 750, 210, 61, white)
  my putText(s3, "Discover a new perspective" & return & "in every file.", 50, 455, 550, 100, 24, ice)
  my putText(s3, "CARINA NEBULA / NASA, ESA, CSA, STScI", 50, 605, 1100, 30, 11, muted)
  my putText(s3, "filens / 03", 50, 641, 400, 25, 11, muted)
  tell application "Keynote"
    save docRef in outputFile
    close docRef saving no
  end tell
end run
