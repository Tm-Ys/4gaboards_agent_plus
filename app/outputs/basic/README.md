# basic 场景集

任务二默认数据源：118 功能点 / 179 场景（`features.json` + `scenarios.json`），经 `scenarioStore.loadScenarioSet("basic")` 加载。

## ⚠️ instance 设置开关簇：demo 站环境受限（不计入通过率分母）

下列 instance 开关类场景在被测站点 `demo.4gaboards.com` 上**不可执行**——该站 `demoMode=true`，把 `/settings/instance` 页的全部开关 `<input class="Radio_input__58pdU" disabled="">` 物理禁用。页面亦明确提示 "Demo Mode - some features affecting other users are disabled!"。

侦察脚本 `app/src/agent/recon-settings.ts` 与截图 `app/outputs/recon-instance.png`（显示开关 disabled）为佐证。

> 这些场景的失败是**环境限制，非 agent 缺陷**；统计通过率时应单独列出、不计入有效分母。

受限场景（13 个）：

- `instance-sso-registration-enable` / `instance-sso-registration-disable`
- `instance-registration-toggle-1` / `instance-registration-toggle-2`
- `instance-project-creation-1` / `instance-project-creation-2`
- `instance-sync-sso-data-enable` / `instance-sync-sso-data-disable`
- `instance-sync-sso-admin-enable` / `instance-sync-sso-admin-disable`
- `instance-local-registration-enable` / `instance-local-registration-disable`
- `instance-grant-admin-1`（Users 表的 admin 开关同样受 demoMode 限制）

instance 簇中**不受** demoMode 限制的非开关操作（`instance-add-user` / `instance-users-list` / `instance-view-activity-log` / `instance-allowed-domains`）仍可测，待后续补工具覆盖。
