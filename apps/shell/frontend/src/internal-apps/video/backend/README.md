# Video Backend

There's no backend yet. The widget plays whatever URL the payload names. When the
engine starts sending video (`run.response.widgets`), it hands its `video` payloads
to the shell's media inbox (`showInWidget`), and the stream itself needs no shell
backend. A future local-file or transcoding source would go here.
