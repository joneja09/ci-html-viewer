# CI HTML Viewer

Publish HTML reports from Azure Pipelines (build/release tab) or GitHub Actions (job summary, artifacts, and a sticky pull request comment).

Local CSS, JavaScript, and images are inlined by default so coverage-style folders render.

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
