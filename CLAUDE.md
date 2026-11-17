# herdr-shared 작업 규칙

이 저장소가 `bin/` 과 `tools/` 파일을 고치는 유일한 자리다. 테마 저장소에 들어간 사본
(vendored copy)은 손으로 고치지 않는다. 공개 패키지가 mod 폴더 하나만 복사하기 때문에
테마 저장소는 사본을 커밋해 두고, 그 사본은 `tools/vendor.sh` 가 쓴다.

## 변경 후 순서

1. 이 저장소에서 고친다.
2. `npm test` 로 확인한다.
3. `./tools/install.sh` 로 `${HERDR_SHARED_HOME:-$HOME/.local/share/herdr-shared}` 를 갱신한다.
4. 아래 표의 테마 저장소마다 필요한 그룹을 다시 vendor 한다.

```sh
# 예: fm27
cd ~/git-repo/herdr-fm27
~/git-repo/herdr-shared/tools/vendor.sh \
  accounts mods/fm-staff scan mods/fm-squad editor mods/fm-editor \
  herdr-open tools/herdr-open merge-keys tools
```

`vendor.sh` 는 `<group> <target-dir>` 쌍을 필요한 만큼 반복해서 받는다.

## 테마 저장소와 대상 경로

| 저장소 | 다시 vendor 할 그룹 → 대상 |
|---|---|
| herdr-arcade | accounts → mods/arcade-accounts, scan → mods/arcade-cards, editor → mods/arcade-editor, herdr-open → tools/herdr-open |
| herdr-chiikawa-cards | accounts → mods/chiikawa-accounts, scan → mods/chiikawa-cards, editor → mods/chiikawa-editor, herdr-open → tools/herdr-open |
| herdr-claude-accounts | accounts → mods/claude-accounts |
| herdr-control-tower | accounts → mods/claude-accounts, scan → mods/pulse |
| herdr-fm27 | accounts → mods/fm-staff, scan → mods/fm-squad, editor → mods/fm-editor, herdr-open → tools/herdr-open, merge-keys → tools |
| herdr-inkpaw-hollow | accounts → mods/inkpaw-shed, scan → mods/inkpaw-journal, editor → mods/inkpaw-editor |
| herdr-night-city-downtown | accounts → mods/night-city-accounts, scan → mods/night-city-street, editor → mods/night-city-editor, merge-keys → tools |
| herdr-regent | accounts → mods/regent, scan → mods/regent, merge-keys → tools |

## 제약

- `accounts` 그룹의 5파일은 같은 폴더에 있어야 한다. `cca` 가 자기 옆에서
  `models.mjs`·`usage-api.mjs`·`codex-usage.mjs` 를 찾는다.
- `bin/hv` 는 자기가 놓인 폴더 이름에서 편집기 mod id 를 얻는다. 폴더 이름이
  `-editor` 로 끝나지 않으면 `HV_MOD` 로 지정해야 한다.
- `herdr-open/build.sh` 는 시스템 기본 앱을 바꾼다. 테스트에서 실제 `~/Applications` 나
  기본 앱을 건드리지 않는다. 모든 도구를 스텁하고 임시 `HOME` 을 쓴다.
- 테스트는 실제 키체인이나 네트워크를 읽지 않는다. `cca` 의 api 조회는 임시
  `XDG_STATE_HOME` 에 새 `.api-fetch` 스탬프를 두어 막는다.
