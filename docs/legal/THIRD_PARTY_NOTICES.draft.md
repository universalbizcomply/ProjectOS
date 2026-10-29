# Third-party notices — ported source code

> **DRAFT for legal review (2026-10-29). Not yet committed.**
>
> **Scope.** This file covers **source code that ProjectOS copies and adapts ("ports") from other
> open-source projects** into its own repository. It does **not** cover packages that ProjectOS installs
> as dependencies (npm, Cargo, pip, Gradle, CocoaPods and others). Dependency licence notices are
> generated from the lockfiles and listed separately.
>
> **How to read it.** Each section names one upstream project: its URL, the pinned commit ProjectOS ported
> from, its licence, its full copyright line, and the full licence text. The exact list of ported files,
> with source path, commit and ProjectOS path, is in the register `docs/legal/PORTED_FILES.tsv`. Every
> ported file also carries a header naming its source (see `docs/legal/porting-convention.md`).
>
> **Status of sections.** §1–§8 cover the six source projects named in the port plan, plus Pi / pi-mono,
> which is credited inside OpenClaw. The "Conditional entries" at the end apply only if a file containing
> that embedded code is actually ported. Delete any conditional entry that the register does not need
> before release, and delete any project section with no rows in the register.

| § | Project | Licence | Copyright | Pinned commit | NOTICE file |
|---|---|---|---|---|---|
| 1 | Hermes Agent | MIT | Copyright (c) 2025 Nous Research | `ef75bc7` | none |
| 2 | OpenClaw | MIT | Copyright (c) 2026 OpenClaw Foundation | `bde3017` | none (has `THIRD_PARTY_NOTICES.md`) |
| 3 | Pi / pi-mono (via OpenClaw) | MIT | Copyright (c) 2025 Mario Zechner | n/a (inherited) | none |
| 4 | OpenBot (CopilotKit) | MIT | Copyright (c) 2026 CopilotKit | `4766e42` | none |
| 5 | oh-my-hermes | MIT | Copyright (c) 2026 oh-my-hermes contributors | `612a1cd` | none |
| 6 | OpenBot (Intel ISL) | MIT + embedded Apache-2.0 | Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab) | `c5f0527` | none |
| 7 | Rakazo | Apache-2.0 | Copyright 2026 Rakazo contributors | `bf78ebd` | none |
| 8 | Apache License 2.0 text | — | — | — | — |

## 1. Hermes Agent

- **Upstream:** https://github.com/NousResearch/hermes-agent
- **Pinned commit:** `ef75bc708867e3884cb40a91363be6dc6fddc034` (2026-10-28T23:07:47-07:00)
- **Licence:** MIT (`LICENSE` at the repository root)
- **Copyright:** Copyright (c) 2025 Nous Research
- **Ported files:** see `docs/legal/PORTED_FILES.tsv`, rows with `source_project = hermes-agent`

```text
MIT License

Copyright (c) 2025 Nous Research

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 2. OpenClaw

- **Upstream:** https://github.com/openclaw/openclaw
- **Pinned commit:** `bde3017359edf796459ad4d5e3753ac6b84a49bf` (2026-10-29T17:20:45+08:00)
- **Licence:** MIT (`LICENSE` at the repository root)
- **Copyright:** Copyright (c) 2026 OpenClaw Foundation
- **Ported files:** see `docs/legal/PORTED_FILES.tsv`, rows with `source_project = openclaw`
- **Inherited notices:** OpenClaw's own `THIRD_PARTY_NOTICES.md` states that portions of OpenClaw were
  adapted from Pi / pi-mono, without listing the files. ProjectOS therefore carries the Pi notice (§3)
  for **every** OpenClaw-derived file. OpenClaw also adapts code from Hermes Agent (§1).

```text
MIT License

Copyright (c) 2026 OpenClaw Foundation

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 3. Pi / pi-mono (credited inside OpenClaw)

- **Upstream:** https://github.com/earendil-works/pi-mono (now redirects to https://github.com/earendil-works/pi)
- **Package family:** `@earendil-works/pi-*`
- **How it reaches ProjectOS:** through OpenClaw, whose `THIRD_PARTY_NOTICES.md` (at the OpenClaw commit above)
  states "Portions of OpenClaw were adapted from Pi / pi-mono". ProjectOS ports no Pi file directly.
- **Licence:** MIT
- **Copyright:** Copyright (c) 2025 Mario Zechner

```text
MIT License

Copyright (c) 2025 Mario Zechner

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 4. OpenBot (CopilotKit)

- **Upstream:** https://github.com/CopilotKit/OpenBot
- **Pinned commit:** `4766e4247675eb73ff80d525ff645dd8a9da815f` (2026-10-28T22:41:19-07:00)
- **Licence:** MIT (`LICENSE` at the repository root)
- **Copyright:** Copyright (c) 2026 CopilotKit
- **Ported files:** see `docs/legal/PORTED_FILES.tsv`, rows with `source_project = copilotkit-openbot`
- Not to be confused with §6 (isl OpenBot), which is an unrelated robotics project.

```text
MIT License

Copyright (c) 2026 CopilotKit

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 5. oh-my-hermes

- **Upstream:** https://github.com/rlaope/oh-my-hermes
- **Pinned commit:** `612a1cd9c44a19ecddcd263865e40e8c3910a514` (2026-10-29T13:46:02Z; from the GitHub archive
  `oh-my-hermes-main.zip`, SHA-256 `2055af1e7853d8c05ba891087edf579f3a3dd8762d50b02cd97ed04bc86f1913`)
- **Licence:** MIT (`LICENSE` at the repository root)
- **Copyright:** Copyright (c) 2026 oh-my-hermes contributors
- **Ported files:** see `docs/legal/PORTED_FILES.tsv`, rows with `source_project = oh-my-hermes`

```text
MIT License

Copyright (c) 2026 oh-my-hermes contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 6. OpenBot (Intel ISL, "Turning Smartphones into Robots")

- **Upstream:** https://github.com/ob-f/OpenBot (formerly https://github.com/intel-isl/OpenBot, later
  https://github.com/isl-org/OpenBot; both old URLs redirect to `ob-f/OpenBot`)
- **Pinned commit:** `c5f05271a067ca83d3de38e5976fa07bcec74b6e` (2026-10-25T03:05:27Z; from the GitHub archive
  `OpenBot-master.zip`, SHA-256 `91b3b57467cbe414cb37d48a0d4f805aa7e0e72d94a527c95150be5163f67043`)
- **Licence:** MIT (`LICENSE` at the repository root), with embedded Apache-2.0 files (§6.1)
- **Copyright:** Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)
- **Ported files:** see `docs/legal/PORTED_FILES.tsv`, rows with `source_project = isl-openbot`

```text
MIT License

Copyright (c) 2020 Intel ISL (Intel Intelligent Systems Lab)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### 6.1 Apache-2.0 files embedded in isl OpenBot (include only if such a file is ported)

These files carry their own Apache-2.0 header, not the MIT notice. Any ported file keeps its original
header, gains a "Modified by ProjectOS" statement (Apache-2.0 §4(b)), and is listed in the register.
The upstreams below were checked for a `NOTICE` file at the time of writing and none has one, so no
§4(d) NOTICE text applies: `tensorflow/examples`, `tensorflow/tensorflow`, `google-ar/arcore-android-sdk`,
`google/blockly`.

| Copyright line (verbatim from the file header) | Files in isl OpenBot |
|---|---|
| `Copyright 2019 The TensorFlow Authors. All Rights Reserved.` | `robot/android/app/src/main/java/org/openbot/app/robot/{tflite/Detector,tflite/Network,tracking/MultiBoxTracker,env/BorderedText,env/ImageUtils,env/Logger,env/Size,customview/*(7),original/*(4)}.java`, `robot/android/app/src/main/res/layout/{activity_camera,camera_connection_fragment,camera_connection_fragment_tracking}.xml` |
| `Copyright 2017 The TensorFlow Authors. All Rights Reserved.` | `robot/android/app/src/main/java/org/openbot/app/robot/tflite/DetectorDefault.java` |
| `Copyright 2017 Google Inc. All Rights Reserved.` | `robot/android/app/src/main/java/org/openbot/app/robot/pointGoalNavigation/rendering/{BackgroundRenderer,ObjectRenderer,ShaderUtil,TwoDRenderer}.java`, `robot/android/app/src/main/assets/shaders/{object,screenquad}.{frag,vert}` |
| `Copyright 2019 Google LLC` | `open-code/src/components/blockly/index.js`, `open-code/src/components/blockly/generator/javascriptGenerator.js` |

The Apache License 2.0 text is reproduced once, in §8.

### 6.2 BSD-3-Clause file embedded in isl OpenBot (include only if ported; not in the current port plan)

`policy/openbot/associate_frames.py` ("Modified and extended by Matthias Mueller - Intel Intelligent Systems Lab - 2020"):

```text
Software License Agreement (BSD License)

Copyright (c) 2013, Juergen Sturm, TUM
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions
are met:

 * Redistributions of source code must retain the above copyright
   notice, this list of conditions and the following disclaimer.
 * Redistributions in binary form must reproduce the above
   copyright notice, this list of conditions and the following
   disclaimer in the documentation and/or other materials provided
   with the distribution.
 * Neither the name of TUM nor the names of its
   contributors may be used to endorse or promote products derived
   from this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
"AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS
FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT,
INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING,
BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT
LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN
ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.
```

## 7. Rakazo

- **Upstream:** https://github.com/elie222/rakazo
- **Pinned commit:** `bf78ebd7961a28a8b437c605319c47b59edadc1c` (2026-10-29T13:41:43Z; from the GitHub archive
  `rakazo-main.zip`, SHA-256 `01a955e678b5c335ef6f7636b3cb8cb5d458493a6ff75409e6c10e324f20d75b`)
- **Licence:** Apache License 2.0 (`LICENSE` at the repository root; the terms are identical to the canonical
  Apache-2.0 text, compared after whitespace normalisation. 21 of its 25 `package.json` files say
  `Apache-2.0`. The other 4, the native modules under `apps/mobile/modules/`, have no `license` field and
  fall under the root `LICENSE`)
- **Copyright:** Copyright 2026 Rakazo contributors
- **NOTICE file:** none at the pinned commit, so there is no §4(d) NOTICE content to reproduce.
- **Modifications:** every ported file is modified by ProjectOS and carries a "Modified by ProjectOS
  <date>" statement (Apache-2.0 §4(b)). See `docs/legal/PORTED_FILES.tsv`, rows with `source_project = rakazo`.
- **Trademarks:** Apache-2.0 §6 grants no right to the Rakazo name or marks. ProjectOS does not use them.

Rakazo's own licence-application notice (verbatim from the end of its `LICENSE`):

```text
Copyright 2026 Rakazo contributors

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

## 8. Apache License, Version 2.0 (applies to §6.1 and §7)

The text below is copied verbatim from Rakazo's `LICENSE` (terms and conditions, sections 1–9).

```text
Apache License
Version 2.0, January 2004
http://www.apache.org/licenses/

TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION

1. Definitions.

"License" shall mean the terms and conditions for use, reproduction, and
distribution as defined by Sections 1 through 9 of this document.

"Licensor" shall mean the copyright owner or entity authorized by the
copyright owner that is granting the License.

"Legal Entity" shall mean the union of the acting entity and all other
entities that control, are controlled by, or are under common control with
that entity. For the purposes of this definition, "control" means (i) the
power, direct or indirect, to cause the direction or management of such
entity, whether by contract or otherwise, or (ii) ownership of fifty percent
(50%) or more of the outstanding shares, or (iii) beneficial ownership of
such entity.

"You" (or "Your") shall mean an individual or Legal Entity exercising
permissions granted by this License.

"Source" form shall mean the preferred form for making modifications,
including but not limited to software source code, documentation source, and
configuration files.

"Object" form shall mean any form resulting from mechanical transformation or
translation of a Source form, including but not limited to compiled object
code, generated documentation, and conversions to other media types.

"Work" shall mean the work of authorship, whether in Source or Object form,
made available under the License, as indicated by a copyright notice that is
included in or attached to the work (an example is provided in the Appendix
below).

"Derivative Works" shall mean any work, whether in Source or Object form,
that is based on (or derived from) the Work and for which the editorial
revisions, annotations, elaborations, or other modifications represent, as a
whole, an original work of authorship. For the purposes of this License,
Derivative Works shall not include works that remain separable from, or
merely link (or bind by name) to the interfaces of, the Work and Derivative
Works thereof.

"Contribution" shall mean any work of authorship, including the original
version of the Work and any modifications or additions to that Work or
Derivative Works thereof, that is intentionally submitted to Licensor for
inclusion in the Work by the copyright owner or by an individual or Legal
Entity authorized to submit on behalf of the copyright owner. For the
purposes of this definition, "submitted" means any form of electronic,
verbal, or written communication sent to the Licensor or its representatives,
including but not limited to communication on electronic mailing lists,
source code control systems, and issue tracking systems that are managed by,
or on behalf of, the Licensor for the purpose of discussing and improving
the Work, but excluding communication that is conspicuously marked or
otherwise designated in writing by the copyright owner as "Not a Contribution."

"Contributor" shall mean Licensor and any individual or Legal Entity on
behalf of whom a Contribution has been received by Licensor and subsequently
incorporated within the Work.

2. Grant of Copyright License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable copyright license to
reproduce, prepare Derivative Works of, publicly display, publicly perform,
sublicense, and distribute the Work and such Derivative Works in Source or
Object form.

3. Grant of Patent License. Subject to the terms and conditions of this
License, each Contributor hereby grants to You a perpetual, worldwide,
non-exclusive, no-charge, royalty-free, irrevocable (except as stated in
this section) patent license to make, have made, use, offer to sell, sell,
import, and otherwise transfer the Work, where such license applies only to
those patent claims licensable by such Contributor that are necessarily
infringed by their Contribution(s) alone or by combination of their
Contribution(s) with the Work to which such Contribution(s) was submitted.
If You institute patent litigation against any entity (including a
cross-claim or counterclaim in a lawsuit) alleging that the Work or a
Contribution incorporated within the Work constitutes direct or contributory
patent infringement, then any patent licenses granted to You under this
License for that Work shall terminate as of the date such litigation is
filed.

4. Redistribution. You may reproduce and distribute copies of the Work or
Derivative Works thereof in any medium, with or without modifications, and
in Source or Object form, provided that You meet the following conditions:

(a) You must give any other recipients of the Work or Derivative Works a
copy of this License; and

(b) You must cause any modified files to carry prominent notices stating
that You changed the files; and

(c) You must retain, in the Source form of any Derivative Works that You
distribute, all copyright, patent, trademark, and attribution notices from
the Source form of the Work, excluding those notices that do not pertain to
any part of the Derivative Works; and

(d) If the Work includes a "NOTICE" text file as part of its distribution,
then any Derivative Works that You distribute must include a readable copy
of the attribution notices contained within such NOTICE file, excluding
those notices that do not pertain to any part of the Derivative Works, in at
least one of the following places: within a NOTICE text file distributed as
part of the Derivative Works; within the Source form or documentation, if
provided along with the Derivative Works; or, within a display generated by
the Derivative Works, if and wherever such third-party notices normally
appear. The contents of the NOTICE file are for informational purposes only
and do not modify the License. You may add Your own attribution notices
within Derivative Works that You distribute, alongside or as an addendum to
the NOTICE text from the Work, provided that such additional attribution
notices cannot be construed as modifying the License.

You may add Your own copyright statement to Your modifications and may
provide additional or different license terms and conditions for use,
reproduction, or distribution of Your modifications, or for any such
Derivative Works as a whole, provided Your use, reproduction, and
distribution of the Work otherwise complies with the conditions stated in
this License.

5. Submission of Contributions. Unless You explicitly state otherwise, any
Contribution intentionally submitted for inclusion in the Work by You to the
Licensor shall be under the terms and conditions of this License, without
any additional terms or conditions. Notwithstanding the above, nothing
herein shall supersede or modify the terms of any separate license agreement
you may have executed with Licensor regarding such Contributions.

6. Trademarks. This License does not grant permission to use the trade
names, trademarks, service marks, or product names of the Licensor, except
as required for reasonable and customary use in describing the origin of the
Work and reproducing the content of the NOTICE file.

7. Disclaimer of Warranty. Unless required by applicable law or agreed to
in writing, Licensor provides the Work (and each Contributor provides its
Contributions) on an "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
KIND, either express or implied, including, without limitation, any
warranties or conditions of TITLE, NON-INFRINGEMENT, MERCHANTABILITY, or
FITNESS FOR A PARTICULAR PURPOSE. You are solely responsible for determining
the appropriateness of using or redistributing the Work and assume any risks
associated with Your exercise of permissions under this License.

8. Limitation of Liability. In no event and under no legal theory, whether
in tort (including negligence), contract, or otherwise, unless required by
applicable law (such as deliberate and grossly negligent acts) or agreed to
in writing, shall any Contributor be liable to You for damages, including
any direct, indirect, special, incidental, or consequential damages of any
character arising as a result of this License or out of the use or inability
to use the Work (including but not limited to damages for loss of goodwill,
work stoppage, computer failure or malfunction, or any and all other
commercial damages or losses), even if such Contributor has been advised of
the possibility of such damages.

9. Accepting Warranty or Additional Liability. While redistributing the
Work or Derivative Works thereof, You may choose to offer, and charge a fee
for, acceptance of support, warranty, indemnity, or other liability
obligations and/or rights consistent with this License. However, in
accepting such obligations, You may act only on Your own behalf and on Your
sole responsibility, not on behalf of any other Contributor, and only if
You agree to indemnify, defend, and hold each Contributor harmless for any
liability incurred by, or claims asserted against, such Contributor by
reason of your accepting any such warranty or additional liability.

END OF TERMS AND CONDITIONS
```


## Conditional entries (embedded third-party code inside planned port paths)

Keep an entry only if the register lists a ported file that contains this code. Each entry names the
file where the code sits upstream.

| Entry | Embedded in (upstream path) | Licence | Copyright |
|---|---|---|---|
| C.1 | OpenClaw `packages/terminal-core/src/ansi.ts` ("derived from ansi-regex and strip-ansi") | MIT | Copyright (c) Sindre Sorhus |
| C.2 | OpenClaw `packages/gateway-protocol/src/compiled/sender-identity.js` and `src/compiled/protocol.generated/predicates.js` (generated TypeBox validators) | MIT | Copyright (c) 2017-2026 Haydn Paterson |
| C.3 | OpenClaw `extensions/slack/skills/_vendor/` | MIT | Copyright (c) 2020- Slack Technologies, LLC |
| C.4 | Hermes `tools/approval_detection.py` (one rule marked "Port of openai/codex#33464") | Apache-2.0 + Codex NOTICE | Copyright 2025 OpenAI |

### C.1 ansi-regex / strip-ansi (Sindre Sorhus)

```text
MIT License

Copyright (c) Sindre Sorhus <sindresorhus@gmail.com> (https://sindresorhus.com)

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### C.2 TypeBox (Haydn Paterson)

```text
MIT License

Copyright (c) 2017-2026 Haydn Paterson

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### C.3 Slack skills plugin (Slack Technologies, LLC)

```text
The MIT License (MIT)

Copyright (c) 2020- Slack Technologies, LLC

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

### C.4 OpenAI Codex NOTICE (only if `tools/approval_detection.py` logic marked "Port of openai/codex#33464" is translated)

Codex is Apache-2.0 (§8). Its `NOTICE` file (fetched from the default branch on 2026-10-29) reads:

```text
OpenAI Codex
Copyright 2025 OpenAI

This project includes code derived from [Ratatui](https://github.com/ratatui/ratatui), licensed under the MIT license.
Copyright (c) 2016-2022 Florian Dehau
Copyright (c) 2023-2025 The Ratatui Developers
```

---

*End of draft. Dependency licence notices (npm, Cargo, pip and others) are produced separately from the
lockfiles and are not part of this file.*
