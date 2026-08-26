# HTML Report Portal

Publish self-contained HTML reports and view them as a tab on Azure Pipelines build and release results. Each tab embeds the report and provides a download link.

Use this for Newman HTML Extra, Playwright, Cypress, coverage, or any other self-contained HTML file.

For full documentation see [GitHub](https://github.com/joneja09/azure-pipelines-html-viewer).

## Configuration

Add the **Upload HTML Report** task after your tests produce HTML output. Use `condition: succeededOrFailed()` so reports still publish when tests fail.

- `reportDir` (required): a single `.html`/`.htm` file, or a directory searched recursively
- `tabName` (optional): tab label on the pipeline run
- `redactSecrets` (optional): mask Bearer tokens and common secret keys (useful for Postman/Newman reports)
- `failOnEmpty` (optional): fail when no HTML files are found

```yaml
steps:
- task: UploadPortalHtmlReport@1
  displayName: Upload HTML reports
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/reports'
    tabName: 'Test Reports'
```
