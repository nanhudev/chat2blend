import hashlib
import json
import os
import pathlib
import re
import shutil
import subprocess
import sys
import zipfile

REPOSITORY = os.environ["GITHUB_REPOSITORY"]
REPO = REPOSITORY.split("/")[1]
VERSION = "0.4.2"
TAG = "desktop-v" + VERSION
OUT = pathlib.Path("release-publish")
SOURCE = os.environ["SOURCE_SHA"]
RUN = os.environ["SOURCE_RUN"]

def gh(*args):
    return subprocess.check_output(["gh", *args], text=True).strip()

def api(endpoint):
    return json.loads(gh("api", "repos/" + REPOSITORY + "/" + endpoint))

def digest(file):
    return hashlib.file_digest(file.open("rb"), "sha256").hexdigest()

def validate():
    if not RUN.isdecimal() or not re.fullmatch(r"[a-f0-9]{40}", SOURCE):
        raise RuntimeError("Invalid build reference")
    run = api("actions/runs/" + RUN)
    if run["name"] != "Desktop installers" or run["head_branch"] != "main" or run["head_sha"] != SOURCE or run["conclusion"] != "success":
        raise RuntimeError("Expected a successful native desktop build of the exact main commit")
    if gh("api", "repos/" + REPOSITORY + "/commits/main", "--jq", ".sha") != SOURCE:
        raise RuntimeError("Main changed after this build; publish its current build instead")
    if subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip() != SOURCE:
        raise RuntimeError("Checkout does not match verified build")
    print("Verified native desktop build", RUN, SOURCE)

def prepare():
    validate()
    OUT.mkdir(exist_ok=True)
    names = [f"{REPO}-{VERSION}-Setup-x64.exe", f"{REPO}-{VERSION}-Portable-x64.exe",
             f"{REPO}-{VERSION}-mac-arm64.dmg", f"{REPO}-{VERSION}-linux-x64.AppImage",
             f"{REPO}-{VERSION}-linux-amd64.deb"]
    for name in names:
        found = list(pathlib.Path("desktop-artifacts").rglob(name))
        if len(found) != 1 or found[0].stat().st_size < 50_000_000:
            raise RuntimeError("Missing or invalid platform artifact: " + name)
        shutil.copy2(found[0], OUT / name)
    previews = list(pathlib.Path("desktop-artifacts/desktop-ubuntu-22.04").rglob("desktop.png"))
    if len(previews) != 1:
        raise RuntimeError("Missing Linux packaged-window preview")
    shutil.copy2(previews[0], OUT / "desktop-preview.png")
    guide = pathlib.Path("docs/QUICKSTART.md").read_text(encoding="utf-8")
    guide = guide.replace("](DESKTOP.md)", f"](https://github.com/{REPOSITORY}/blob/main/docs/DESKTOP.md)")
    (OUT / "QUICKSTART.zh-CN.md").write_text(guide, encoding="utf-8")
    example = ""
    if REPO == "chat2blend":
        with zipfile.ZipFile(OUT / "robot-asset.zip", "w", zipfile.ZIP_DEFLATED) as archive:
            for name in ("robot.blend", "robot.glb", "base_color.png", "normal.png", "roughness.png", "robot.png", "asset.json"):
                archive.write(pathlib.Path("docs/assets/robot") / name, name)
        example = "[机器人资产样例](BASE/robot-asset.zip)：含独立部件、UV、贴图、骨骼、挥手动作、Blender 工程与 GLB。当前完整配方面向机械机器人。"
    elif REPO == "ai-teacher-coach":
        shutil.copy2("docs/assets/lesson-example.pptx", OUT / "lesson-example.pptx")
        example = "[可编辑课件样例](BASE/lesson-example.pptx)：固定测试样例，未调用 AI，使用前由教师复核。"
    product = json.loads(pathlib.Path("desktop/product.json").read_text(encoding="utf-8"))
    base = f"https://github.com/{REPOSITORY}/releases/download/{TAG}"
    notes = f"""# {product["name"]} Desktop {VERSION}

{product["description"]}

## 下载

| 系统 | 安装版 | 便携版 |
|---|---|---|
| Windows x64 | [Setup EXE](BASE/{REPO}-{VERSION}-Setup-x64.exe) | [Portable EXE](BASE/{REPO}-{VERSION}-Portable-x64.exe) |
| Apple Silicon Mac | [arm64 DMG](BASE/{REPO}-{VERSION}-mac-arm64.dmg) | — |
| Linux x64 | [Debian / Ubuntu deb](BASE/{REPO}-{VERSION}-linux-amd64.deb) | [AppImage](BASE/{REPO}-{VERSION}-linux-x64.AppImage) |

[三分钟上手](https://github.com/{REPOSITORY}/blob/main/docs/QUICKSTART.md) · [下载使用指南](BASE/QUICKSTART.zh-CN.md) · [构建与授权](https://github.com/{REPOSITORY}/blob/main/docs/DESKTOP.md)

## 本版更新

- 内置离线中文字体，修复 Linux 界面与发布截图中的方块字。
- 优化三款应用的布局、产品配色、导航状态、输入焦点和成果卡片。
- 增加轻量入场、按钮与处理状态动效，尊重系统减少动态效果设置。
- Windows、macOS、Linux 均在各自原生环境重新构建并检查打包后的应用窗口。
- Linux 检查覆盖打包程序、实际安装的 deb 和解包后的 AppImage AppRun；运行于 Ubuntu 22.04 虚拟显示器。
- 文档面向使用者和开源贡献者，提供安装、操作、授权、构建与问题反馈说明。

![实际 Linux 桌面界面](BASE/desktop-preview.png)

{example}

## 使用与验证范围

Linux 登录需要可用的 GNOME Keyring 或 KWallet；AppImage 需要系统支持 FUSE，Debian / Ubuntu 用户可以优先使用 deb。Chat2Blend 需要安装 Blender。

安装包尚未商业签名或 Apple 公证。界面、固定样例和软件检查已经完成；真实账户登录与 AI 请求仍需使用者本人完成授权和验收。账户资格及额度以官方授权和实际请求为准。

[文件校验值](BASE/SHA256SUMS) · [构建来源与检查记录](BASE/BUILD_PROVENANCE.json) · [报告问题](https://github.com/{REPOSITORY}/issues)
""".replace("BASE/", base + "/")
    (OUT / "RELEASE_NOTES.md").write_text(notes, encoding="utf-8")
    artifacts = [{"file": p.name, "bytes": p.stat().st_size, "sha256": digest(p)} for p in sorted(OUT.iterdir())]
    proof = {"product": REPO, "version": VERSION, "sourceCommit": SOURCE,
             "workflow": f"https://github.com/{REPOSITORY}/actions/runs/{RUN}",
             "nativePackagedWindows": ["Windows x64", "macOS arm64", "Ubuntu 22.04 x64"],
             "linuxAcceptance": ["packaged window", "installed deb window", "extracted AppImage AppRun window"],
             "nativeCodexVersionVerified": REPO == "agent2llm",
             "realAccountAuthorizationAndInference": "requires user acceptance",
             "codeSigned": False, "appleNotarized": False, "artifacts": artifacts}
    (OUT / "BUILD_PROVENANCE.json").write_text(json.dumps(proof, ensure_ascii=False, indent=2), encoding="utf-8")
    (OUT / "SHA256SUMS").write_text("".join(digest(p) + "  " + p.name + "\n" for p in sorted(OUT.iterdir()) if p.name != "SHA256SUMS"), encoding="utf-8")

def publish():
    validate()
    result = subprocess.run(["gh", "release", "view", TAG, "--repo", REPOSITORY], capture_output=True)
    if result.returncode:
        subprocess.run(["gh", "release", "create", TAG, "--repo", REPOSITORY, "--target", SOURCE,
                        "--title", REPO + " Desktop " + VERSION, "--prerelease", "--draft",
                        "--notes-file", str(OUT / "RELEASE_NOTES.md")], check=True)
    subprocess.run(["gh", "release", "upload", TAG, *[str(p) for p in sorted(OUT.iterdir())],
                    "--repo", REPOSITORY, "--clobber"], check=True)
    releases = api("releases")
    release = next(r for r in releases if r["tag_name"] == TAG)
    for file in OUT.iterdir():
        found = [a for a in release["assets"] if a["name"] == file.name]
        if len(found) != 1 or found[0]["state"] != "uploaded" or found[0]["size"] != file.stat().st_size or found[0]["digest"] != "sha256:" + digest(file):
            raise RuntimeError("Uploaded artifact failed verification: " + file.name)
    subprocess.run(["gh", "release", "edit", TAG, "--repo", REPOSITORY, "--draft=false",
                    "--prerelease", "--latest=false", "--notes-file", str(OUT / "RELEASE_NOTES.md")], check=True)
    print("Public desktop release verified:", release["html_url"])

{"validate": validate, "prepare": prepare, "publish": publish}[sys.argv[1]]()

