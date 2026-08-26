const { test, describe } = require("node:test")
const assert = require("node:assert/strict")
const { join } = require("path")
const { load } = require("cheerio")
const {
  findHtmlFiles,
  displayNameFor,
  generateAttachmentName,
  parseAttachmentName,
  isReportSuccessful,
  redactObject,
  redactHtmlDocument,
  shouldRedactKey
} = require("../lib")

const fixtures = join(__dirname, "fixtures")

describe("findHtmlFiles", () => {
  test("finds html and htm files recursively and ignores other files", () => {
    const files = findHtmlFiles(fixtures).map((file) => displayNameFor(file, fixtures))
    assert.deepEqual(files, [
      "generic.html",
      "nested/deep/report.htm",
      "newman-fail.html",
      "newman-pass.html"
    ])
  })

  test("accepts a single HTML file", () => {
    const file = join(fixtures, "generic.html")
    assert.deepEqual(findHtmlFiles(file), [file])
  })

  test("returns an empty list for a directory with no HTML files", () => {
    const { mkdtempSync } = require("fs")
    const { tmpdir } = require("os")
    const emptyDir = mkdtempSync(join(tmpdir(), "html-report-empty-"))
    assert.deepEqual(findHtmlFiles(emptyDir), [])
  })

  test("rejects a non-HTML file", () => {
    assert.throws(() => findHtmlFiles(join(fixtures, "ignore.txt")), /not an HTML file/)
  })
})

describe("attachment names", () => {
  test("round-trips tab, job, stage, attempt, and nested file names", () => {
    const name = generateAttachmentName({
      tabName: "Playwright Report",
      jobName: "Run tests",
      stageName: "QA",
      stageAttempt: 2,
      fileName: "nested/deep/report.htm"
    })
    assert.equal(
      name,
      "Playwright Report~run-tests~qa~2~nested_deep_report.htm"
    )
    assert.deepEqual(parseAttachmentName(name), {
      tabName: "Playwright Report",
      jobName: "run-tests",
      stageName: "qa",
      stageAttempt: "2",
      fileName: "nested_deep_report.htm"
    })
  })

  test("parses legacy dot-delimited names", () => {
    const parsed = parseAttachmentName("Postman.job.stage.1.report.html")
    assert.equal(parsed.tabName, "Postman")
    assert.equal(parsed.fileName, "report.html")
  })
})

describe("isReportSuccessful", () => {
  test("detects Newman HTML Extra failures", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-fail.html"), "utf8")
    assert.equal(isReportSuccessful(html), false)
  })

  test("detects Newman HTML Extra passes", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-pass.html"), "utf8")
    assert.equal(isReportSuccessful(html), true)
  })

  test("treats generic HTML as successful", () => {
    const html = require("fs").readFileSync(join(fixtures, "generic.html"), "utf8")
    assert.equal(isReportSuccessful(html), true)
  })

  test("does not throw when Failed Tests is missing", () => {
    assert.equal(isReportSuccessful("<html></html>"), true)
  })
})

describe("secret redaction", () => {
  test("redacts nested secret keys", () => {
    const redacted = redactObject({
      ok: true,
      password: "hunter2",
      nested: { access_token: "abc", user: "ada" },
      list: [{ refresh_token: "r" }]
    })
    assert.equal(redacted.ok, true)
    assert.equal(redacted.password, "***")
    assert.equal(redacted.nested.access_token, "***")
    assert.equal(redacted.nested.user, "ada")
    assert.equal(redacted.list[0].refresh_token, "***")
  })

  test("matches secret-like key names case-insensitively", () => {
    assert.equal(shouldRedactKey("Password"), true)
    assert.equal(shouldRedactKey("apiToken"), true)
    assert.equal(shouldRedactKey("user"), false)
  })

  test("masks bearer tokens and JSON secret fields in HTML", () => {
    const html = require("fs").readFileSync(join(fixtures, "newman-fail.html"), "utf8")
    const document = load(html)
    redactHtmlDocument(document)
    const output = document.html()
    assert.match(output, /Bearer \*\*\*/)
    assert.doesNotMatch(output, /super-secret-token/)
    assert.doesNotMatch(output, /hunter2/)
    assert.doesNotMatch(output, /abc123/)
    assert.match(output, /"user": "ada"/)
  })
})
