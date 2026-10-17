# Reproducing the TrackNet V3 runtime

Run from a PowerShell terminal with Git and Python 3.11 installed:

```powershell
.\scripts\setup-tracknet-v3.ps1
# If the Windows py launcher is unavailable:
.\scripts\setup-tracknet-v3.ps1 -Python 'C:\Python311\python.exe'
```

The script creates the ignored `.tracknet-v3` runtime and installs the exact
versions in `scripts/requirements-tracknet-v3.txt` into its `.venv`. It clones
[TrackNetV3](https://github.com/qaz812345/TrackNetV3) at commit
`6eda442ada1740573f200f836d93edc9a541ee86` using a detached checkout. An existing
checkout must have that commit, the expected origin, and no tracked changes;
setup stops without resetting or replacing a different checkout. An existing
environment must use Python 3.11. Matching installed package versions skip
installation; otherwise pip installs the pinned requirements and checks their
dependencies. Additional packages already in the environment are retained.

Do not run setup while another process is creating the environment or installing
packages. Once a separately managed installation has finished, `-SkipInstall`
reuses its environment without checking or installing dependencies. A setup lock
prevents concurrent copies of this script; after an interrupted run, remove
`.tracknet-v3/setup.lock` only after confirming no setup process remains.

The layout is:

```text
.tracknet-v3/
  repo/                      # Pinned upstream source
  .venv/                     # Python 3.11 environment
  ckpts/
    TrackNet_best.pt
    InpaintNet_best.pt
    provenance.json
  data/TrackNetV3_ckpts.zip   # Original archive, when available
  openvino/                  # Reserved for explicitly requested conversion
```

The [pinned upstream README](https://github.com/qaz812345/TrackNetV3/blob/6eda442ada1740573f200f836d93edc9a541ee86/README.md)
links the official checkpoint archive with Google Drive ID
`1CfzE87a0f6LhBp0kniSl1-89zaLCZ8cA`. Setup invokes the environment's `gdown`
only when a required checkpoint and the local archive are missing. You can also
place that archive at `.tracknet-v3/data/TrackNetV3_ckpts.zip` before running setup.

The Python helper streams only the basenames `TrackNet_best.pt` and
`InpaintNet_best.pt` into `ckpts`. It never loads checkpoint objects. It rejects
unsafe member paths, links, duplicate checkpoint basenames, encrypted checkpoint
entries, missing checkpoints, and checkpoint entries exceeding 2 GiB each. Both
checkpoint entries are validated in a temporary directory before any missing
asset is published. Existing files must match the archive and any recorded
hashes; mismatches stop setup without overwriting those files. A failed or
interrupted copy can be retried; incomplete existing assets require manual
inspection and are never silently replaced.

`ckpts/provenance.json` records the source repository, pinned source commit,
Drive ID, archive SHA256 when available, and each checkpoint's SHA256 and byte
count. Repeat runs validate those hashes and preserve the manifest. Existing
checkpoints without an archive are retained and recorded as
`existing-local-hashes-only`; this records observed local bytes and does not
prove they came from the official archive. Even `archive-matched` records a
local comparison, not an independently published upstream checksum. The Drive
ID can serve changed bytes over time; retain the manifest and original ZIP to
reproduce a specific download. The requirements pin direct package versions,
not all transitive dependencies or platform wheels.

To verify or prepare local checkpoint assets without installing packages,
cloning, or allowing a download:

```powershell
.\.tracknet-v3\.venv\Scripts\python.exe scripts/prepare-tracknet-v3-checkpoints.py --runtime-dir .tracknet-v3
```

Conversion is disabled by default. After the baseline has been run and the
exporter is available, this explicit command calls
`scripts/export-tracknet-v3.py` with the V3 environment from the project root:

```powershell
.\scripts\setup-tracknet-v3.ps1 -SkipInstall -Convert
```

Conversion uses `public/tracknet_predict.mp4` for its comparison inputs by
default. Pass `-Video 'C:\videos\match.mp4'` to use a different file. The exporter
checks both models against PyTorch and writes `openvino/conversion-check.json`.
The service requires this check to pass. Use the original unmarked match video
for real accuracy evaluation; the supplied prediction video already has marks.

The exporter owns its conversion options and output behavior. Setup reports a
clear error if `-Convert` is requested before that script exists. Engine startup
commands and overrides are in [tracknet-engines.md](tracknet-engines.md).

Offline helper tests use synthetic ZIP files and do not touch the installed
runtime, download models, or run inference:

```powershell
.\.tracknet-v3\.venv\Scripts\python.exe scripts/test_tracknet_v3_setup.py
```

## Local hardware and FFmpeg inspection

Read-only checks on this Windows machine found a 12th Gen Intel Core i7-1255U,
12 logical processors visible to the process, and Intel Iris Xe Graphics.
FFmpeg `n7.0` successfully reported its version from:

```text
C:\Program Files\Streamlabs OBS\resources\app.asar.unpacked\node_modules\obs-studio-node\ffmpeg.exe
```

This location is already among the launcher's fallback candidates. The inspected
OBS Studio directory contained `obs-ffmpeg-mux.exe`, but no `ffmpeg.exe` at the
launcher's other candidate path. CIM hardware inventory was denied in the
restricted session; memory capacity and GPU memory were not verified. These are
host observations, not runtime requirements or inference performance results.
