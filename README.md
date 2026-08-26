# Azure DevOps HTML Report Portal

Publish HTML reports and view them as a tab on Azure Pipelines build and release results.

Each tab embeds the report in the pipeline UI, with per-report download and an optional zip of the whole folder.

This project is a fork of [maciejmaciejewski/azure-pipelines-postman](https://github.com/maciejmaciejewski/azure-pipelines-postman), generalized beyond Postman reports.

## Configuration

Add the **Upload HTML Report** task after your tests produce HTML output. Use `condition: succeededOrFailed()` so reports still publish when tests fail.

| Input | Default | Description |
| --- | --- | --- |
| `reportDir` | `$(System.DefaultWorkingDirectory)` | A single `.html`/`.htm` file, or a directory searched recursively |
| `tabName` | `HTML Report` | Tab label on the pipeline run |
| `inlineAssets` | `true` | Embed local CSS, JS, and images so multi-file reports (coverage, etc.) render in the tab |
| `publishArchive` | `true` | Attach a zip of a report **directory** (skipped above 50 MB; `node_modules` is omitted) |
| `redactSecrets` | `false` | Mask Bearer tokens and common secret keys (useful for Newman HTML Extra) |
| `failOnEmpty` | `true` | Fail when no HTML files are found |
| `failOnFailedReports` | `false` | Fail after upload when a report looks unsuccessful (Newman failed tests or Playwright `unexpected` count) |

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

Local `link`, `script`, and `img` references are inlined into each HTML file before upload. That is enough for typical coverage folders (JaCoCo, Istanbul). Playwright/Cypress apps that `fetch()` extra JSON at runtime still need a self-contained HTML export, or use **Download all** for the original folder.

```yaml
- task: UploadPortalHtmlReport@1
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/coverage'
    tabName: 'Coverage'
```

Run the task more than once with different `tabName` values to publish multiple report groups.

![](./docs/postman-report-2.png)

## Example

### Report summary on the build tab

![](./docs/postman-report-1.png)

## Development

```bash
npm install
npm run build
npm install --prefix tasks/UploadPortalHtmlReport
npm test
```

The upload task runs on Node 16 and Node 20 pipeline agents. Node 10 is no longer supported.

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
