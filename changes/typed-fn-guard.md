# A guard against shaders that only compile once

- The repo check now catches the kind of shader slip that would have broken the fields' look in a second view (a minimap or reflections): a shader helper that reads town-wide settings instead of taking them as inputs.
