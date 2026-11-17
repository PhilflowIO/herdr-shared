# herdr-shared 작업 규칙

이 저장소가 `bin/` 과 `tools/` 파일을 고치는 유일한 자리다. 테마 저장소에 들어간 사본
(vendored copy)은 손으로 고치지 않는다. 공개 패키지가 mod 폴더 하나만 복사하기 때문에
테마 저장소는 사본을 커밋해 두고, 그 사본은 `tools/vendor.sh` 가 쓴다.

## 변경 후 순서

1. 이 저장소에서 고친다.
2. `npm test` 로 확인한다.
3. `./tools/install.sh` 로 `${HERDR_SHARED_HOME:-$HOME/.local/share/herdr-shared}` 를 갱신한다.
4. `tools/sync-themes.sh --commit --push` 로 모든 테마에 반영한다.

```sh
~/git-repo/herdr-shared/tools/sync-themes.sh --commit --push
```

`sync-themes.sh` 는 `themes.list` 의 테마마다 `vendor/herdr-shared` 서브모듈을 이 저장소의
HEAD 로 옮기고, 테마의 `herdr-shared.list` 가 가리키는 사본을 다시 쓴 뒤 `check-vendor.sh`
와 테마 테스트를 돌리고, 포인터와 사본을 `chore: herdr-shared <short sha> 반영` 으로 커밋한다.
이 저장소가 clean 이고 HEAD 가 upstream 에 있을 때만, 선택한 테마가 모두 온전할 때만 시작한다.

테마별 대상은 각 테마 저장소의 `herdr-shared.list` 가 정본이다. 손으로 vendor 하지 않는다.
`vendor.sh` 는 `<group> <target-dir>` 쌍을 필요한 만큼 반복해서 받고, `--list <테마루트>` 로
`herdr-shared.list` 전체를 한 번에 처리한다.

## 테마별 그룹 → 대상

| 저장소 | 그룹 → 대상 (테마의 `herdr-shared.list`) |
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
