# Azure DevOps HTML Report Portal

Publish self-contained HTML reports (Newman HTML Extra, Playwright, Cypress, coverage, or any other HTML file) and view them as a tab on Azure Pipelines build and release results.

Each tab embeds the report in the pipeline UI and provides a download link.

This project is a fork of [maciejmaciejewski/azure-pipelines-postman](https://github.com/maciejmaciejewski/azure-pipelines-postman), generalized beyond Postman reports.

## Configuration

Add the **Upload HTML Report** task after your tests produce HTML output. Use `condition: succeededOrFailed()` so reports still publish when tests fail.

The task takes:

- `reportDir` (required) — a single `.html`/`.htm` file, or a directory that is searched recursively
- `tabName` (optional) — tab label on the pipeline run (default: `HTML Report`)
- `redactSecrets` (optional) — mask Bearer tokens and common secret keys before upload (default: `false`)
- `failOnEmpty` (optional) — fail the task when no HTML files are found (default: `true`)

Reports should be **self-contained** HTML (CSS/JS inlined). Companion assets such as Playwright's `playwright-report/` folder are not published as a static site.

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
```

### Directory of reports

```yaml
- task: UploadPortalHtmlReport@1
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/reports'
    tabName: 'QA Reports'
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
