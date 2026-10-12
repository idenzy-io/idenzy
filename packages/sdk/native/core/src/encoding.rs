//! The four text encodings the protocol needs, written out rather than taken as dependencies.
//!
//! Each is a page of well-specified code and each is tested against its specification's own
//! examples. The crates that would supply them bring Unicode tables and feature flags measured in
//! hundreds of kilobytes, paid once per architecture by every app that ships this library.

use std::time::{Duration, SystemTime, UNIX_EPOCH};

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url (RFC 4648 §5), the form PKCE and JWTs both use.
pub(crate) fn base64url_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let symbols = chunk.len() + 1;
        for i in 0..symbols {
            let index = (n >> (18 - 6 * i)) & 0x3f;
            out.push(char::from(BASE64URL[index as usize]));
        }
    }
    out
}

/// Decodes unpadded base64url, tolerating padding. `None` for anything that is not base64url.
pub(crate) fn base64url_decode(text: &str) -> Option<Vec<u8>> {
    let trimmed = text.trim_end_matches('=');
    if trimmed.len() % 4 == 1 {
        return None;
    }
    let mut out = Vec::with_capacity(trimmed.len() * 3 / 4);
    let mut buffer: u32 = 0;
    let mut bits = 0;
    for byte in trimmed.bytes() {
        let value = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'-' => 62,
            b'_' => 63,
            _ => return None,
        };
        buffer = (buffer << 6) | u32::from(value);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((buffer >> bits) as u8);
            buffer &= (1 << bits) - 1;
        }
    }
    Some(out)
}

/// `encodeURIComponent`, byte for byte, so a device name reaches the server exactly as the
/// browser SDK would have sent it and a path segment cannot escape its segment.
pub(crate) fn percent_encode_component(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for byte in text.bytes() {
        let unreserved = byte.is_ascii_alphanumeric()
            || matches!(
                byte,
                b'-' | b'_' | b'.' | b'!' | b'~' | b'*' | b'\'' | b'(' | b')'
            );
        if unreserved {
            out.push(char::from(byte));
        } else {
            out.push_str(&format!("%{byte:02X}"));
        }
    }
    out
}

/// One `application/x-www-form-urlencoded` value, as `URLSearchParams` decodes it: `+` is a
/// space, and a malformed escape is kept literally rather than refused.
pub(crate) fn form_decode(text: &str) -> String {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => out.push(b' '),
            b'%' if i + 2 < bytes.len() => match (hex(bytes[i + 1]), hex(bytes[i + 2])) {
                (Some(high), Some(low)) => {
                    out.push(high << 4 | low);
                    i += 2;
                }
                _ => out.push(b'%'),
            },
            other => out.push(other),
        }
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex(byte: u8) -> Option<u8> {
    match byte {
        b'0'..=b'9' => Some(byte - b'0'),
        b'a'..=b'f' => Some(byte - b'a' + 10),
        b'A'..=b'F' => Some(byte - b'A' + 10),
        _ => None,
    }
}

/// An RFC 3339 timestamp with an offset, which is what `isoDateTimeSchema` admits.
///
/// Accepts `Z`, `±HH:MM`, `±HHMM` and `±HH`, and any number of fractional digits. `None` for
/// anything else, which the caller reports as a response that is not the protocol's shape.
pub(crate) fn parse_rfc3339(text: &str) -> Option<SystemTime> {
    let bytes = text.as_bytes();
    if bytes.len() < 20 || bytes[4] != b'-' || bytes[7] != b'-' || bytes[13] != b':' {
        return None;
    }
    if !matches!(bytes[10], b'T' | b't') || bytes[16] != b':' {
        return None;
    }
    let year = digits(&bytes[0..4])?;
    let month = digits(&bytes[5..7])?;
    let day = digits(&bytes[8..10])?;
    let hour = digits(&bytes[11..13])?;
    let minute = digits(&bytes[14..16])?;
    let second = digits(&bytes[17..19])?;
    if !(1..=12).contains(&month) || day == 0 || day > days_in_month(year, month) {
        return None;
    }
    if hour > 23 || minute > 59 || second > 59 {
        return None;
    }

    let mut rest = &bytes[19..];
    let mut nanos: u32 = 0;
    if rest.first() == Some(&b'.') {
        let fraction_len = rest[1..].iter().take_while(|b| b.is_ascii_digit()).count();
        if fraction_len == 0 {
            return None;
        }
        for (i, digit) in rest[1..=fraction_len].iter().take(9).enumerate() {
            nanos += u32::from(digit - b'0') * 10u32.pow(8 - i as u32);
        }
        rest = &rest[1 + fraction_len..];
    }

    let offset_seconds: i64 = match rest {
        [b'Z' | b'z'] => 0,
        [sign @ (b'+' | b'-'), tail @ ..] => {
            let (hours, minutes) = match tail {
                [h1, h2] => (digits(&[*h1, *h2])?, 0),
                [h1, h2, b':', m1, m2] | [h1, h2, m1, m2] => {
                    (digits(&[*h1, *h2])?, digits(&[*m1, *m2])?)
                }
                _ => return None,
            };
            if hours > 23 || minutes > 59 {
                return None;
            }
            let magnitude = i64::from(hours * 3600 + minutes * 60);
            if *sign == b'+' { magnitude } else { -magnitude }
        }
        _ => return None,
    };

    let days = days_from_civil(i64::from(year), month, day);
    let local = days * 86_400 + i64::from(hour * 3600 + minute * 60 + second);
    let utc = local - offset_seconds;
    let base = if utc >= 0 {
        UNIX_EPOCH.checked_add(Duration::from_secs(utc.unsigned_abs()))?
    } else {
        UNIX_EPOCH.checked_sub(Duration::from_secs(utc.unsigned_abs()))?
    };
    base.checked_add(Duration::from_nanos(u64::from(nanos)))
}

fn digits(bytes: &[u8]) -> Option<u32> {
    bytes.iter().try_fold(0u32, |acc, byte| {
        byte.is_ascii_digit()
            .then(|| acc * 10 + u32::from(byte - b'0'))
    })
}

fn days_in_month(year: u32, month: u32) -> u32 {
    match month {
        2 if year % 4 == 0 && (year % 100 != 0 || year % 400 == 0) => 29,
        2 => 28,
        4 | 6 | 9 | 11 => 30,
        _ => 31,
    }
}

/// Days since 1970-01-01 in the proleptic Gregorian calendar (Hinnant's `days_from_civil`).
fn days_from_civil(year: i64, month: u32, day: u32) -> i64 {
    let year = if month <= 2 { year - 1 } else { year };
    let era = if year >= 0 { year } else { year - 399 } / 400;
    let year_of_era = year - era * 400;
    let month_from_march = (i64::from(month) + 9) % 12;
    let day_of_year = (153 * month_from_march + 2) / 5 + i64::from(day) - 1;
    let day_of_era = year_of_era * 365 + year_of_era / 4 - year_of_era / 100 + day_of_year;
    era * 146_097 + day_of_era - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;

    fn seconds(time: SystemTime) -> f64 {
        time.duration_since(UNIX_EPOCH).unwrap().as_secs_f64()
    }

    #[test]
    fn base64url_matches_rfc_4648_vectors() {
        let cases: [(&[u8], &str); 7] = [
            (b"", ""),
            (b"f", "Zg"),
            (b"fo", "Zm8"),
            (b"foo", "Zm9v"),
            (b"foob", "Zm9vYg"),
            (b"fooba", "Zm9vYmE"),
            (b"foobar", "Zm9vYmFy"),
        ];
        for (raw, encoded) in cases {
            assert_eq!(base64url_encode(raw), encoded);
            assert_eq!(base64url_decode(encoded).unwrap(), raw);
        }
        assert_eq!(base64url_encode(&[0xfb, 0xff]), "-_8");
        assert_eq!(base64url_decode("-_8").unwrap(), vec![0xfb, 0xff]);
        assert_eq!(base64url_decode("Zm8=").unwrap(), b"fo");
    }

    #[test]
    fn base64url_refuses_what_is_not_base64url() {
        assert_eq!(base64url_decode("ab+c"), None);
        assert_eq!(base64url_decode("abcde"), None);
    }

    #[test]
    fn percent_encoding_matches_encode_uri_component() {
        assert_eq!(
            percent_encode_component("Hasan'ın MacBook'u"),
            "Hasan'%C4%B1n%20MacBook'u"
        );
        assert_eq!(percent_encode_component("a/b?c&d=e"), "a%2Fb%3Fc%26d%3De");
        assert_eq!(percent_encode_component("-_.!~*'()"), "-_.!~*'()");
    }

    #[test]
    fn form_decoding_matches_url_search_params() {
        assert_eq!(form_decode("a+b%20c"), "a b c");
        assert_eq!(form_decode("%E2%9C%93"), "✓");
        assert_eq!(form_decode("100%"), "100%");
        assert_eq!(form_decode("%zz"), "%zz");
    }

    #[test]
    fn rfc3339_parses_the_forms_the_protocol_admits() {
        assert_eq!(seconds(parse_rfc3339("1970-01-01T00:00:00Z").unwrap()), 0.0);
        assert_eq!(
            seconds(parse_rfc3339("2026-10-12T07:00:00.000Z").unwrap()),
            1_791_788_400.0
        );
        assert_eq!(
            parse_rfc3339("2026-10-12T10:00:00+03:00"),
            parse_rfc3339("2026-10-12T07:00:00Z")
        );
        assert_eq!(
            parse_rfc3339("2026-10-12T02:30:00-0430"),
            parse_rfc3339("2026-10-12T07:00:00Z")
        );
        assert_eq!(
            parse_rfc3339("2026-10-12T09:00:00+02"),
            parse_rfc3339("2026-10-12T07:00:00Z")
        );
        assert_eq!(
            seconds(parse_rfc3339("2024-02-29T12:00:00.5Z").unwrap()),
            1_709_208_000.5
        );
        assert_eq!(
            parse_rfc3339("1969-12-31T23:59:59Z"),
            UNIX_EPOCH.checked_sub(Duration::from_secs(1))
        );
    }

    #[test]
    fn rfc3339_refuses_what_the_protocol_does_not() {
        for text in [
            "2026-10-12T07:00:00",
            "2026-10-12 07:00:00Z",
            "2026-13-01T00:00:00Z",
            "2025-02-29T00:00:00Z",
            "2026-10-12T24:00:00Z",
            "2026-10-12T07:00:00.Z",
            "2026-10-12T07:00:00+3:00",
            "not a date at all",
        ] {
            assert_eq!(parse_rfc3339(text), None, "{text}");
        }
    }
}
