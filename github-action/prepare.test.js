const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { join } = require("path")
const { mkdtempSync, writeFileSync, readFileSync, mkdirSync } = require("fs")
const { tmpdir } = require("os")
const {
  buildCommentMarkdown,
  commentMarker,
  isTruthy,
  prepareReports,
  sanitizeArtifactName
} = require("./prepare")

describe("helpers", () => {
  test("isTruthy treats missing values as the default", () => {
    assert.equal(isTruthy(undefined, true), true)
    assert.equal(isTruthy("", false), false)
    assert.equal(isTruthy("true", false), true)
    assert.equal(isTruthy("false", true), false)
  })

  test("sanitizeArtifactName strips illegal characters", () => {
    assert.equal(sanitizeArtifactName("QA: Reports/v1"), "QA- Reports-v1")
  })
})

describe("buildCommentMarkdown", () => {
  test("includes a sticky marker, table, and workflow link", () => {
    const markdown = buildCommentMarkdown({
      name: "Coverage",
      reports: [
        { fileName: "index.html", successful: true },
        { fileName: "nested/fail.html", successful: false }
      ],
      failedCount: 1,
      runUrl: "https://github.com/acme/repo/actions/runs/9",
      artifactName: "Coverage",
      archiveIncluded: true
    })
    assert.match(markdown, new RegExp(commentMarker("Coverage")))
    assert.match(markdown, /\*\*1 failed\*\*, 1 passed/)
    assert.match(markdown, /index\.html/)
    assert.match(markdown, /nested\/fail\.html/)
    assert.match(markdown, /https:\/\/github.com\/acme\/repo\/actions\/runs\/9/)
    assert.match(markdown, /zip of the original report folder/)
  })
})

describe("prepareReports", () => {
  test("inlines assets, writes reports, and builds PR markdown", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gha-html-"))
    writeFileSync(join(dir, "style.css"), "h1{color:navy}")
    writeFileSync(
      join(dir, "index.html"),
      "<html><head><link rel=\"stylesheet\" href=\"style.css\"></head><body><h1>OK</h1></body></html>"
    )
    mkdirSync(join(dir, "extra"), { recursive: true })
    writeFileSync(join(dir, "extra", "other.html"), "<html><body>Other</body></html>")

    const result = await prepareReports({
      reportDir: dir,
      name: "Coverage",
      outputDir: join(dir, "out"),
      runUrl: "https://example.test/run/1"
    })

    assert.equal(result.empty, false)
    assert.equal(result.reports.length, 2)
    assert.equal(result.reports[0].fileName, "index.html")
    assert.equal(result.archiveIncluded, true)
    assert.equal(result.failedCount, 0)
    const inlined = readFileSync(join(result.outputDir, "reports", "index.html"), "utf8")
    assert.match(inlined, /h1\{color:navy\}/)
    assert.match(result.markdown, /Coverage/)
    assert.match(result.markdown, /https:\/\/example.test\/run\/1/)
  })

  test("returns empty when no HTML is present", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gha-empty-"))
    writeFileSync(join(dir, "notes.txt"), "nope")
    const result = await prepareReports({
      reportDir: dir,
      name: "HTML Report",
      outputDir: join(dir, "out")
    })
    assert.equal(result.empty, true)
    assert.equal(result.reports.length, 0)
    assert.match(result.markdown, /No HTML files found/)
  })
})
