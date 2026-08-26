# CI HTML Viewer

Publish HTML reports from CI and view them where the work happens:

- **GitHub Actions** — workflow summary, artifact download, and a sticky pull request comment
- **Azure Pipelines** — an embedded tab on the build or release result page

This project is a fork of [maciejmaciejewski/azure-pipelines-postman](https://github.com/maciejmaciejewski/azure-pipelines-postman), generalized beyond Postman reports.

## GitHub Actions

The repository is an action. On a pull request it posts (or updates) a comment with pass/fail for each HTML file and a link to the workflow artifacts. On `push` it still writes the job summary and uploads artifacts.

```yaml
name: Tests
on:
  pull_request:
  push:
    branches: [main]

permissions:
  contents: write       # push HTML preview to gh-pages
  pull-requests: write  # sticky PR comment

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm test -- --reporter=html --output=reports
      - uses: joneja09/azure-pipelines-html-viewer@v1
        if: always()
        with:
          report-dir: reports
          name: Test Reports
          fail-on-failed-reports: true
```

If this repository is renamed to `ci-html-viewer`, change that to `joneja09/ci-html-viewer@v1`. Until then, use the current repo name.

| Input | Default | Description |
| --- | --- | --- |
| `report-dir` | required | A single `.html`/`.htm` file, or a directory searched recursively |
| `name` | `HTML Report` | Artifact name, summary heading, and PR comment title |
| `inline-assets` | `true` | Embed local CSS, JS, and images |
| `publish-archive` | `true` | Include a zip of a report directory in the artifact |
| `redact-secrets` | `false` | Mask Bearer tokens and common secret keys |
| `fail-on-empty` | `true` | Fail when no HTML files are found |
| `fail-on-failed-reports` | `false` | Fail the job after publishing when a report looks unsuccessful |
| `comment-on-pr` | `true` | Post or update a sticky comment on `pull_request` workflows |
| `pages-preview` | `true` | Publish inlined HTML to the `gh-pages` branch and link each report in the PR comment |
| `upload-artifact` | `true` | Upload prepared reports as a workflow artifact |

GitHub cannot embed a full HTML report inside a PR thread (comments are markdown). The comment is the scoreboard; each report name links to a GitHub Pages preview of that HTML file. Re-runs update the same sticky comment (`<!-- ci-html-viewer:Name -->`) instead of adding a new one.

Enable **Settings → Pages → Deploy from branch `gh-pages`** once so those links render. Until that is set, the comment still posts and artifacts still upload; HTML links may 404. Preview deploy is best-effort and will not fail the job if the push is denied.

Fork PRs only get a comment when the workflow token has `pull-requests: write`. Job summaries and artifacts still publish.

## Azure Pipelines

Add the **Upload HTML Report** task after your tests produce HTML. Use `condition: succeededOrFailed()` so reports still publish when tests fail.

| Input | Default | Description |
| --- | --- | --- |
| `reportDir` | `$(System.DefaultWorkingDirectory)` | A single `.html`/`.htm` file, or a directory searched recursively |
| `tabName` | `HTML Report` | Tab label on the pipeline run |
| `inlineAssets` | `true` | Embed local CSS, JS, and images so multi-file reports render in the tab |
| `publishArchive` | `true` | Attach a zip of a report **directory** (skipped above 50 MB; `node_modules` is omitted) |
| `redactSecrets` | `false` | Mask Bearer tokens and common secret keys (useful for Newman HTML Extra) |
| `failOnEmpty` | `true` | Fail when no HTML files are found |
| `failOnFailedReports` | `false` | Fail after upload when a report looks unsuccessful |

`index.html` is listed first when a directory contains several HTML files. A single report is expanded automatically in the tab.

```yaml
steps:
- task: UploadPortalHtmlReport@1
  displayName: Upload HTML reports
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/reports'
    tabName: 'Test Reports'
```

### Newman / Postman HTML Extra

```yaml
- script: npx newman run collection.json -r htmlextra --reporter-htmlextra-export reports/newman.html
- task: UploadPortalHtmlReport@1
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/reports/newman.html'
    tabName: 'Postman'
    redactSecrets: true
    failOnFailedReports: true
```

### Coverage or other multi-file HTML

Local `link`, `script`, and `img` references are inlined into each HTML file before upload. That is enough for typical coverage folders (JaCoCo, Istanbul). Playwright/Cypress apps that `fetch()` extra JSON at runtime still need a self-contained HTML export, or download the zip / GitHub artifact of the original folder.

```yaml
- task: UploadPortalHtmlReport@1
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/coverage'
    tabName: 'Coverage'
```

Run the Azure task more than once with different `tabName` values to publish multiple report groups. For GitHub Actions, run the action multiple times with different `name` values (each gets its own artifact and sticky comment).

![](./docs/postman-report-2.png)

## Example

### Report summary on the Azure DevOps build tab

![](./docs/postman-report-1.png)

## Repository name

`ci-html-viewer` is a better GitHub name now that this is not Azure-only. Rename in GitHub Settings when you are ready; clone URLs will change, but `action.yml` at the repo root already matches that identity. Keep the Azure DevOps extension id (`html-report-portal`) as-is so existing installs do not break.

## Development

```bash
npm install
npm run build
npm install --prefix tasks/UploadPortalHtmlReport
npm test
node --test github-action/*.test.js
```

The Azure upload task runs on Node 16 and Node 20 pipeline agents. Node 10 is no longer supported.

## Contributors

<!-- prettier-ignore-start -->
<!-- markdownlint-disable -->
<table>
  <tr>
      <td align="center">
      <a href="https://github.com/joneja09">
        <img src="https://avatars.githubusercontent.com/u/33398109?v=4" width="100px;" alt=""/>
        <br />
        <b>Jeff Jones</b>
    </td>
    <td align="center">
      <a href="https://github.com/maciejmaciejewski">
        <img src="https://avatars1.githubusercontent.com/u/15831316?v=4" width="100px;" alt=""/>
        <br />
        <b>Maciej Maciejewski</b>
    </td>
    <td align="center">
      <a href="https://github.com/afeblot">
        <img src="https://avatars1.githubusercontent.com/u/12073123?v=4" width="100px;" alt=""/>
        <br />
        <b>Alexandre Feblot</b>
    </td>
  </tr>
</table>
<!-- markdownlint-enable -->
<!-- prettier-ignore-end -->
