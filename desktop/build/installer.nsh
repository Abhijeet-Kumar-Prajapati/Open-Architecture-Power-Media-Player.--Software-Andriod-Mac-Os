; NSIS customisation for APM Open Player.
;
; Registers every container we can decode, so after install Windows can offer
; APM Open Player in "Open with" for those files. Registration is best-effort:
; a file already associated with another player is left alone.

!macro customInstall
  WriteRegStr SHCTX "Software\Classes\.mp4" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.mkv" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.avi" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.mov" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.webm" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.ts"   "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.flv"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.wmv"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.m4v"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.ts2"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.mts"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.m2ts" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.mpg"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.mpeg" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.vob"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.rmvb" "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.rm"   "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.3gp"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.ogv"  "" "APMOpenPlayer.Video"
  WriteRegStr SHCTX "Software\Classes\.divx" "" "APMOpenPlayer.Video"

  WriteRegStr SHCTX "Software\Classes\.mp3"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.flac" "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.aac"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.m4a"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.wav"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.ogg"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.opus" "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.wma"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.ape"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.wv"   "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.tta"  "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.aiff" "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.alac" "" "APMOpenPlayer.Audio"
  WriteRegStr SHCTX "Software\Classes\.mka"  "" "APMOpenPlayer.Audio"

  WriteRegStr SHCTX "Software\Classes\.srt"  "" "APMOpenPlayer.Subtitle"
  WriteRegStr SHCTX "Software\Classes\.ass"  "" "APMOpenPlayer.Subtitle"
  WriteRegStr SHCTX "Software\Classes\.ssa"  "" "APMOpenPlayer.Subtitle"
  WriteRegStr SHCTX "Software\Classes\.vtt"  "" "APMOpenPlayer.Subtitle"
  WriteRegStr SHCTX "Software\Classes\.sub"  "" "APMOpenPlayer.Subtitle"

  WriteRegStr SHCTX "Software\Classes\.m3u"  "" "APMOpenPlayer.Playlist"
  WriteRegStr SHCTX "Software\Classes\.m3u8" "" "APMOpenPlayer.Playlist"
  WriteRegStr SHCTX "Software\Classes\.pls"  "" "APMOpenPlayer.Playlist"

  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Video\DefaultIcon" "" "$INSTDIR\resources\app.asar.unpacked\..\APM Open Player.exe,0"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Audio\DefaultIcon" "" "$INSTDIR\resources\app.asar.unpacked\..\APM Open Player.exe,0"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Subtitle\DefaultIcon" "" "$INSTDIR\resources\app.asar.unpacked\..\APM Open Player.exe,0"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Playlist\DefaultIcon" "" "$INSTDIR\resources\app.asar.unpacked\..\APM Open Player.exe,0"

  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Video\shell\open\command" "" '"$INSTDIR\APM Open Player.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Audio\shell\open\command" "" '"$INSTDIR\APM Open Player.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Subtitle\shell\open\command" "" '"$INSTDIR\APM Open Player.exe" "%1"'
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Playlist\shell\open\command" "" '"$INSTDIR\APM Open Player.exe" "%1"'

  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Video" "FriendlyTypeName" "APM Open Player Video"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Audio" "FriendlyTypeName" "APM Open Player Audio"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Subtitle" "FriendlyTypeName" "APM Open Player Subtitle"
  WriteRegStr SHCTX "Software\Classes\APMOpenPlayer.Playlist" "FriendlyTypeName" "APM Open Player Playlist"
!macroend

!macro customUnInstall
  DeleteRegKey SHCTX "Software\Classes\APMOpenPlayer.Video"
  DeleteRegKey SHCTX "Software\Classes\APMOpenPlayer.Audio"
  DeleteRegKey SHCTX "Software\Classes\APMOpenPlayer.Subtitle"
  DeleteRegKey SHCTX "Software\Classes\APMOpenPlayer.Playlist"
!macroend