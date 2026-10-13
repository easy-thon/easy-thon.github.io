# Key sounds

The keyboard sounds in the intro are real keyboards, recorded. Each pack here (`<id>.js`) holds single strokes cut
from recordings of one keyboard: keys going down, coming back up, and (where the recordings have them) the space bar
and enter. The strokes were found by their onsets (or, on keyboards whose keys come up as loudly as they go down, by
the timing of each press and release), trimmed, the room noise reduced where noted, and levelled, then laid end to
end in one FLAC file written into the script. `assets/js/stage/sound.js` loads and plays them.

Each pack keeps the licence of its recordings.

| Pack | Keyboard | Recording | Author | Licence | Changes |
| --- | --- | --- | --- | --- | --- |
| `model-m.js` | IBM Model M2 (buckling springs) | [IBM M2 sound.ogg](https://commons.wikimedia.org/wiki/File:IBM_M2_sound.ogg) (Wikimedia Commons) | Anonimski | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | cut into strokes, room noise reduced, levelled |
| `model-f.js` | IBM Model F 122 (1984) | [Typing - Model F 122 1984.ogg](https://commons.wikimedia.org/wiki/File:Typing_-_Model_F_122_1984.ogg) (Wikimedia Commons) | Raymangold22 | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | the clearest strokes of a fast run cut out, room noise reduced, levelled |
| `mac.js` | Apple Macintosh SE/30 | [WWS MacintoshSE30typing.ogg](https://commons.wikimedia.org/wiki/File:WWS_MacintoshSE30typing.ogg) (Wikimedia Commons) | Work With Sounds / Torsten Nilsson | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) | cut into strokes, room noise reduced, levelled |
| `laptop.js` | Apple MacBook Pro | [Slow MacBook Pro keyboard #1](https://bigsoundbank.com/slow-macbook-pro-keyboard-1-s1728.html), [#2](https://bigsoundbank.com/slow-macbook-pro-keyboard-2-s1729.html) (BigSoundBank) | Joseph Sardin | [CC0 1.0](https://bigsoundbank.com/licenses.html) | cut into presses and releases, levelled |
| `apple.js` | Apple Keyboard (aluminium, with numeric keypad) | [Slow iMac keyboard](https://bigsoundbank.com/slow-imac-keyboard-s1730.html) (BigSoundBank) | Joseph Sardin | [CC0 1.0](https://bigsoundbank.com/licenses.html) | cut into presses and releases, levelled |
| `raspberry.js` | Raspberry Pi keyboard | [Slow Raspberry keyboard](https://bigsoundbank.com/slow-raspberry-keyboard-s1732.html) (BigSoundBank) | Joseph Sardin | [CC0 1.0](https://bigsoundbank.com/licenses.html) | cut into presses and releases, levelled |
| `membrane.js` | Cherry KC 1000 (membrane) | [Keyboard Soundpack #1](https://opengameart.org/content/keyboard-soundpack-1-typing-and-single-keystrokes) (OpenGameArt) | unicaegames | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | cut into strokes, levelled |
| `typewriter.js` | Hermes Precisa 305 (portable typewriter) | [Typewriter #2](https://bigsoundbank.com/typewriter-2-s2835.html) to [#8](https://bigsoundbank.com/typewriter-8-s2841.html), [Typewriter, Bell #1](https://bigsoundbank.com/typewriter-bell-s2844.html) (BigSoundBank) | Joseph Sardin | [CC0 1.0](https://bigsoundbank.com/licenses.html) | cut into strokes (a letter's touch and strike; the carriage stepping on; the space bar), the bell laid over a carriage return for enter, levelled |
| `electric-typewriter.js` | Smith-Corona Prestige Auto 12 (electric typewriter) | [Smith-Corona Prestige Auto 12 typing.ogg](https://commons.wikimedia.org/wiki/File:Smith-Corona_Prestige_Auto_12_typing.ogg) (Wikimedia Commons, from Freesound) | lonemonk | [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/) | cut into strokes, levelled, the bell below laid after a stroke for enter |
| `electric-typewriter.js` (bell) | — | [406243 stubb typewriter-ding-near-mono.wav](https://commons.wikimedia.org/wiki/File:406243_stubb_typewriter-ding-near-mono.wav) (Wikimedia Commons, from Freesound) | _stubb | [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) | trimmed |

The packs made from CC BY recordings are offered under the same licence, with the credit above. The page credits
them too, at its foot ("키보드 소리 출처").
