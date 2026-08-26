# HTML Report Portal

Publish HTML reports and view them as a tab on Azure Pipelines build and release results. Each tab embeds the report, offers a download, and can attach a zip of the original folder.

Local CSS, JavaScript, and images are inlined by default so coverage-style folders render in the tab.

For full documentation see [GitHub](https://github.com/joneja09/azure-pipelines-html-viewer).

## Configuration

Add the **Upload HTML Report** task after your tests produce HTML output. Use `condition: succeededOrFailed()` so reports still publish when tests fail.

```yaml
steps:
- task: UploadPortalHtmlReport@1
  displayName: Upload HTML reports
  condition: succeededOrFailed()
  inputs:
    reportDir: '$(System.DefaultWorkingDirectory)/reports'
    tabName: 'Test Reports'
```
