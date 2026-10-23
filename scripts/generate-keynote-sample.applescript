-- Regenerate the public sample on macOS with Keynote installed:
-- osascript scripts/generate-keynote-sample.applescript /tmp/filens-weekend.key /absolute/path/to/photo-alpine-lake.jpg
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

on run argv
  set outputFile to POSIX file (item 1 of argv)
  set photoFile to POSIX file (item 2 of argv)
  set forest to {12336, 19018, 13364}
  set sage to {31611, 35466, 27756}
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
        set presenter notes of s to "Fictional public travel sample. All routes, groups, and numbers are invented."
      end repeat
    end tell
  end tell
  my putText(s1, "FIELD NOTES / A WEEKEND GUIDE", 52, 48, 600, 30, 14, sage)
  my putText(s1, "A weekend" & return & "outside.", 48, 180, 480, 190, 66, forest)
  my putText(s1, "Slow down. Find a new perspective.", 52, 410, 430, 60, 24, sage)
  my putText(s1, "Fictional routes. A little room to explore.", 52, 485, 430, 45, 16, sage)
  tell application "Keynote" to tell s1 to make new image with properties {file:photoFile, position:{560, 100}, width:590, height:480}
  my putText(s1, "01 / 03     PUBLIC SAMPLE", 52, 620, 700, 30, 12, sage)
  my putText(s2, "A little room to wander.", 52, 55, 1100, 85, 48, forest)
  my putText(s2, "THREE FICTIONAL STOPS / ONE UNHURRIED DAY", 55, 155, 1100, 35, 15, sage)
  my putText(s2, "01", 55, 245, 300, 100, 82, forest)
  my putText(s2, "02", 435, 245, 300, 100, 82, forest)
  my putText(s2, "03", 815, 245, 300, 100, 82, forest)
  my putText(s2, "LAKESIDE", 55, 375, 310, 50, 28, forest)
  my putText(s2, "WOODLAND", 435, 375, 310, 50, 28, forest)
  my putText(s2, "VILLAGE", 815, 375, 310, 50, 28, forest)
  my putText(s2, "Follow the water." & return & "Pause for a photograph.", 55, 450, 310, 100, 22, sage)
  my putText(s2, "Find a shaded trail." & return & "Enjoy a quiet picnic.", 435, 450, 310, 100, 22, sage)
  my putText(s2, "Browse the market." & return & "Try a local cafe.", 815, 450, 310, 100, 22, sage)
  my putText(s2, "02 / 03     ALL PLACES AND FIGURES ARE FICTIONAL", 52, 620, 1000, 30, 12, sage)
  my putText(s3, "Pack light." & return & "Look closer.", 52, 65, 550, 180, 60, forest)
  my putText(s3, "A reusable bottle" & return & "A map for the trail" & return & "A small picnic basket" & return & "Time to enjoy the view", 55, 310, 500, 230, 28, sage)
  tell application "Keynote" to tell s3 to make new image with properties {file:photoFile, position:{650, 100}, width:500, height:480}
  my putText(s3, "03 / 03     TAKE ONLY PHOTOGRAPHS. LEAVE ONLY FOOTPRINTS.", 52, 620, 1100, 30, 12, sage)
  tell application "Keynote"
    save docRef in outputFile
    close docRef saving no
  end tell
end run
