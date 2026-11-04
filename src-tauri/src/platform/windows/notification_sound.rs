use crate::domain::tool_notifications::Sound;
use std::sync::Mutex;

static PLAYBACK: Mutex<()> = Mutex::new(());

#[link(name = "winmm")]
unsafe extern "system" {
    fn PlaySoundW(sound: *const u8, module: *mut std::ffi::c_void, flags: u32) -> i32;
}

fn partial(t: f64, frequency: f64, decay: f64) -> f64 {
    (t * frequency * std::f64::consts::TAU).sin() * (-t * decay).exp()
}

fn soft_note(t: f64, frequency: f64) -> f64 {
    if t < 0.0 {
        return 0.0;
    }
    let attack = 1.0 - (-t / 0.012).exp();
    attack * (partial(t, frequency, 7.0) + 0.12 * partial(t, frequency * 2.0, 16.0))
}

// Original synthesized tones: no external recordings, files, or system sound aliases.
fn wave(sound: Sound) -> Vec<u8> {
    let duration = match sound {
        Sound::Default => 0.80,
        Sound::Bell => 0.95,
        Sound::Clear => 0.38,
        Sound::None => 0.0,
    };
    let rate = 44100u32;
    let count = (rate as f64 * duration) as u32;
    let mut samples = Vec::with_capacity(count as usize);
    for index in 0..count {
        let t = f64::from(index) / f64::from(rate);
        let sample = match sound {
            // Two rounded notes, with the lower response entering after the first strike.
            Sound::Default => soft_note(t, 783.99) + 0.85 * soft_note(t - 0.28, 587.33),
            // Detuned fundamentals and inharmonic overtones give the bell a natural shimmer.
            Sound::Bell => {
                (1.0 - (-t / 0.004).exp())
                    * (0.72 * partial(t, 880.0, 4.5)
                        + 0.28 * partial(t, 882.4, 5.0)
                        + 0.28 * partial(t, 2094.4, 10.0)
                        + 0.10 * partial(t, 3643.2, 19.0))
            }
            // A single bright strike; upper partials decay before the fundamental.
            Sound::Clear => {
                (1.0 - (-t / 0.0025).exp())
                    * (partial(t, 1174.66, 13.0)
                        + 0.32 * partial(t, 2349.32, 28.0)
                        + 0.10 * partial(t, 3523.98, 40.0))
            }
            Sound::None => 0.0,
        };
        samples.push(sample * ((duration - t) / 0.045).clamp(0.0, 1.0));
    }
    // Match average energy while keeping ample peak headroom on all three timbres.
    let peak = samples
        .iter()
        .fold(0.0_f64, |peak, value| peak.max(value.abs()));
    let rms = (samples.iter().map(|v| v * v).sum::<f64>() / samples.len().max(1) as f64).sqrt();
    let gain = if peak > 0.0 {
        (1400.0 / rms).min(8500.0 / peak)
    } else {
        0.0
    };
    let bytes = count * 2;
    let mut out = Vec::with_capacity(44 + bytes as usize);
    out.extend_from_slice(b"RIFF");
    out.extend_from_slice(&(36 + bytes).to_le_bytes());
    out.extend_from_slice(b"WAVEfmt ");
    out.extend_from_slice(&16u32.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&1u16.to_le_bytes());
    out.extend_from_slice(&rate.to_le_bytes());
    out.extend_from_slice(&(rate * 2).to_le_bytes());
    out.extend_from_slice(&2u16.to_le_bytes());
    out.extend_from_slice(&16u16.to_le_bytes());
    out.extend_from_slice(b"data");
    out.extend_from_slice(&bytes.to_le_bytes());
    for sample in samples {
        out.extend_from_slice(&((sample * gain) as i16).to_le_bytes());
    }
    out
}

pub(crate) fn play(sound: Sound) {
    if sound == Sound::None {
        return;
    }
    tauri::async_runtime::spawn_blocking(move || {
        let Ok(_guard) = PLAYBACK.try_lock() else {
            return;
        };
        let data = wave(sound);
        // SND_MEMORY | SND_NODEFAULT; synchronous playback keeps the buffer alive.
        if unsafe { PlaySoundW(data.as_ptr(), std::ptr::null_mut(), 0x0004 | 0x0002) } == 0 {
            eprintln!("[tool-notification] local sound playback failed");
        }
    });
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn notification_tones_are_distinct_bounded_local_pcm() {
        let tones = [Sound::Default, Sound::Bell, Sound::Clear].map(wave);
        for data in &tones {
            assert_eq!(&data[..4], b"RIFF");
            assert_eq!(&data[8..16], b"WAVEfmt ");
            assert_eq!(
                u32::from_le_bytes(data[4..8].try_into().unwrap()) as usize + 8,
                data.len()
            );
            let samples: Vec<i16> = data[44..]
                .chunks_exact(2)
                .map(|v| i16::from_le_bytes(v.try_into().unwrap()))
                .collect();
            assert!(samples.iter().any(|v| v.abs() > 1000));
            assert!(samples.iter().all(|v| v.abs() < 12000));
            assert!(samples.first().unwrap().abs() < 10 && samples.last().unwrap().abs() < 10);
            let rate = u32::from_le_bytes(data[24..28].try_into().unwrap());
            assert_eq!(rate, 44100);
            assert!((0.3..1.0).contains(&(samples.len() as f64 / f64::from(rate))));
            let rms = (samples.iter().map(|v| f64::from(*v).powi(2)).sum::<f64>()
                / samples.len() as f64)
                .sqrt();
            assert!((1300.0..1500.0).contains(&rms), "rms={rms}");
        }
        assert_ne!(tones[0], tones[1]);
        assert_ne!(tones[1], tones[2]);
        assert!(wave(Sound::None)[44..].iter().all(|b| *b == 0));
    }

    #[test]
    fn default_chime_has_a_second_strike_and_bell_has_a_longer_tail() {
        fn energy(data: &[u8], start: f64, end: f64) -> f64 {
            let samples: Vec<f64> = data[44..]
                .chunks_exact(2)
                .map(|v| f64::from(i16::from_le_bytes(v.try_into().unwrap())))
                .collect();
            let range = &samples[(start * 44100.0) as usize..(end * 44100.0) as usize];
            range.iter().map(|v| v * v).sum::<f64>() / range.len() as f64
        }
        let soft = wave(Sound::Default);
        assert!(energy(&soft, 0.30, 0.36) > energy(&soft, 0.21, 0.27) * 2.0);
        let bell = wave(Sound::Bell);
        assert!(energy(&bell, 0.60, 0.70) > 100.0);
        assert!(energy(&bell, 0.60, 0.70) < energy(&bell, 0.10, 0.20));
        assert!(wave(Sound::Clear).len() < soft.len() && soft.len() < bell.len());
    }
}
