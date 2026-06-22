package org.jahia.community.jcrstats;

import org.junit.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * Security-focused unit tests for {@link JcrStatsComputer#jsEscape(String)}: node names end up
 * inside a JavaScript double-quoted string literal in the generated flamegraph HTML, so every
 * character that could break out of that literal (or inject script / terminate a JS line) must be
 * escaped to its inert {@code \\uXXXX} (or backslash) form.
 */
public class JsEscapeTest {

    @Test
    public void jsEscape_null_returnsEmptyString() {
        assertThat(JcrStatsComputer.jsEscape(null)).isEmpty();
    }

    @Test
    public void jsEscape_plainText_isUnchanged() {
        assertThat(JcrStatsComputer.jsEscape("ordinary-name_42")).isEqualTo("ordinary-name_42");
    }

    @Test
    public void jsEscape_backslash_isDoubled() {
        assertThat(JcrStatsComputer.jsEscape("a\\b")).isEqualTo("a\\\\b");
    }

    @Test
    public void jsEscape_doubleQuote_isBackslashEscaped() {
        assertThat(JcrStatsComputer.jsEscape("a\"b")).isEqualTo("a\\\"b");
    }

    @Test
    public void jsEscape_lessThan_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("<")).isEqualTo("\\u003C");
    }

    @Test
    public void jsEscape_greaterThan_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape(">")).isEqualTo("\\u003E");
    }

    @Test
    public void jsEscape_forwardSlash_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("/")).isEqualTo("\\u002F");
    }

    @Test
    public void jsEscape_carriageReturn_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("\r")).isEqualTo("\\u000D");
    }

    @Test
    public void jsEscape_lineFeed_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("\n")).isEqualTo("\\u000A");
    }

    @Test
    public void jsEscape_lineSeparatorU2028_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("\u2028")).isEqualTo("\\u2028");
    }

    @Test
    public void jsEscape_paragraphSeparatorU2029_isUnicodeEscaped() {
        assertThat(JcrStatsComputer.jsEscape("\u2029")).isEqualTo("\\u2029");
    }

    @Test
    public void jsEscape_scriptInjectionAttempt_isFullyNeutralised() {
        // A crafted node name trying to break out of the JS string and inject a <script> tag.
        String malicious = "\"</script><script>alert(1)</script>";
        String escaped = JcrStatsComputer.jsEscape(malicious);

        // No raw angle bracket or slash survives, and every quote is backslash-escaped — nothing
        // can terminate the JS string literal or open an HTML tag.
        assertThat(escaped)
                .doesNotContain("<")
                .doesNotContain(">")
                .doesNotContain("/");
        // The only double-quotes present are escaped ones (\"): no bare quote can close the literal.
        assertThat(escaped.replace("\\\"", "")).doesNotContain("\"");
        assertThat(escaped).isEqualTo(
                "\\\"\\u003C\\u002Fscript\\u003E\\u003Cscript\\u003Ealert(1)\\u003C\\u002Fscript\\u003E");
    }

    @Test
    public void jsEscape_ordinarySpace_isNotEscaped() {
        // Regression guard: a normal U+0020 space must NOT be treated as a line separator.
        assertThat(JcrStatsComputer.jsEscape("a b")).isEqualTo("a b");
    }
}
