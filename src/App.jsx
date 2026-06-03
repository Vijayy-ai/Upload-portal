import React, { useCallback, useEffect, useRef, useState } from "react";
import "./theme.css";
import {
  fetchMyProfile, otpSend, otpResend, otpVerify,
  shortfilmMultipartComplete, shortfilmThumbnailPresign,
  shortfilmUploadStart, shortfilmUploadComplete, s3Put, uploadFileMultipart,
} from "./api.js";

const TOKEN_KEY   = "sf_access";
const MULTIPART_THRESHOLD = 70 * 1024 * 1024; // 70 MB auto-multipart
const THUMB_MIME = "image/webp";
const MAX_COINS   = 50; // PREMIUM_EPISODE_MAX_COINS
const ALL_PLATFORMS = ["SNOOZEIT", "ANYME"];
const PL_LABEL = { SNOOZEIT: "Snoozeit", ANYME: "Anyme" };
const MOODS = [
  { value: "feel-good", label: "Feel-Good Laughter" },
  { value: "adventure", label: "Thrilling Adventures" },
  { value: "sci-fi", label: "Quick Sci-Fi Escapes" },
  { value: "comedy", label: "Comedy Shorts" },
  { value: "drama", label: "Drama Bites" },
  { value: "educational", label: "Learn Something New" },
  { value: "other", label: "Other" },
];

function maskPhone(p) {
  const d = String(p || "").replace(/\D/g, "");
  if (d.length < 5) return d;
  return `${d.slice(0, 2)}••••${d.slice(-3)}`;
}

/* ── Crop image to target W×H (cover-crop, center) ── */
/* ── Crop image to exact W×H using canvas (center-crop / cover fill) ── */
async function cropImage(file, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);

    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Image load failed")); };

    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");

        // Center-crop: cover-fill the target size
        const srcW = img.naturalWidth, srcH = img.naturalHeight;
        const srcA = srcW / srcH, dstA = w / h;
        let sx = 0, sy = 0, sw = srcW, sh = srcH;
        if (srcA > dstA) {
          // Source wider than target — crop the sides
          sw = srcH * dstA;
          sx = (srcW - sw) / 2;
        } else {
          // Source taller than target — crop top/bottom
          sh = srcW / dstA;
          sy = (srcH - sh) / 2;
        }
        ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
        URL.revokeObjectURL(url);

        canvas.toBlob((blob) => {
          if (!blob) { reject(new Error("Canvas toBlob returned null")); return; }
          const name = file.name.replace(/\.[^.]+$/, "") + `_${w}x${h}.webp`;
          resolve(new File([blob], name, { type: THUMB_MIME }));
        }, THUMB_MIME, 0.9);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };

    img.src = url;
  });
}

/* ── Info tooltip ── */
function InfoTip({ text }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);
  return (
    <span className="sf-tip-wrap" ref={ref}>
      <button type="button" className="sf-tip-btn" onClick={() => setOpen(v => !v)} aria-label="Info">i</button>
      {open && <div className="sf-tip-box">{text}</div>}
    </span>
  );
}

/* ── File picker — plain button, crop happens silently ── */
function FilePick({ id, accept, label, tooltip, hint, file, onFile, cropW, cropH }) {
  const ref = useRef(null);
  const [cropping, setCropping] = useState(false);

  async function handleChange(raw) {
    if (!raw) { onFile(null); return; }
    if (cropW && cropH && raw.type.startsWith("image/")) {
      setCropping(true);
      try {
        const cropped = await cropImage(raw, cropW, cropH);
        onFile(cropped);
      } catch (err) {
        console.error("[FilePick] crop failed:", err);
        onFile(null);
        alert(`Could not process image: ${err.message}`);
      } finally {
        setCropping(false);
      }
    } else {
      onFile(raw);
    }
  }

  return (
    <div className="sf-field">
      <div className="sf-label-row">
        <label htmlFor={id}>{label}</label>
        {tooltip && <InfoTip text={tooltip} />}
      </div>
      {hint && <p className="sf-hint">{hint}</p>}
      <button type="button" className="sf-file-btn" onClick={() => ref.current?.click()} disabled={cropping}>
        <span className="sf-file-icon">{cropping ? "⟳" : "⬆"}</span>
        <span className="sf-file-name">
          {cropping ? `Resizing…` : file ? file.name : "Choose file…"}
        </span>
        {file && !cropping && (
          <span className="sf-file-clear"
            onClick={e => { e.stopPropagation(); onFile(null); ref.current.value = ""; }}>✕</span>
        )}
      </button>
      <input ref={ref} id={id} type="file" accept={accept} style={{ display: "none" }}
        onChange={e => handleChange(e.target.files?.[0] || null)} />
    </div>
  );
}


/* ── Profile popup ── */
function ProfilePopup({ profile, approvedPlatforms, onLogout }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [open]);

  const initials = (profile?.display_name || profile?.username || "?").trim().slice(0, 2).toUpperCase();
  return (
    <div className="sf-profile-popup-wrap" ref={ref}>
      <button type="button" className="sf-avatar-btn" onClick={() => setOpen(v => !v)} aria-label="Profile">
        {initials}
      </button>
      {open && (
        <div className="sf-profile-popup">
          <div className="sf-popup-head">
            <div className="sf-popup-avatar">{initials}</div>
            <div>
              <p className="sf-popup-name">{profile?.display_name || profile?.username || "Creator"}</p>
              <p className="sf-popup-handle">{profile?.handle || ""}</p>
            </div>
          </div>
          <div className="sf-popup-chips">
            {profile?.phone_number && <span className="sf-chip">{maskPhone(profile.phone_number)}</span>}
            {approvedPlatforms.map(pl => <span key={pl} className="sf-chip sf-chip-blue">{PL_LABEL[pl] || pl}</span>)}
          </div>
          <button type="button" className="sf-popup-logout" onClick={() => { setOpen(false); onLogout(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export default function App() {
  /* Auth */
  const [phone, setPhone]       = useState("");
  const [code, setCode]         = useState("");
  const [token, setToken]       = useState(() => localStorage.getItem(TOKEN_KEY) || "");
  const [profile, setProfile]   = useState(null);
  /** While true, user is logged in but upload UI waits — avoids a blank page under slow/failed profile fetch. */
  const [profileLoading, setProfileLoading] = useState(false);
  const [profileError, setProfileError] = useState(null);
  const [loginStep, setLoginStep] = useState("phone");
  const [loginMsg, setLoginMsg] = useState({ text: "", isErr: false });
  const [loginBusy, setLoginBusy] = useState(false);

  /* Upload */
  const [platform, setPlatform]       = useState("");
  const [title, setTitle]             = useState("");
  const [description, setDescription] = useState("");
  const [mood, setMood]               = useState("feel-good");
  const [videoFile, setVideoFile]     = useState(null);
  const [cardThumb, setCardThumb]     = useState(null);
  const [heroThumb, setHeroThumb]     = useState(null);
  const [isPremium, setIsPremium]     = useState(false);
  const [premiumCoins, setPremiumCoins] = useState(10);
  const [uploadBusy, setUploadBusy]   = useState(false);
  const [uploadMsg, setUploadMsg]     = useState("");
  const [uploadProgress, setUploadProgress] = useState(null);
  const [uploadDone, setUploadDone] = useState(false);
  /** Bump after each successful upload so file inputs remount — same-file re-pick fires onChange. */
  const [filePickEpoch, setFilePickEpoch] = useState(0);
  const successDismissTimer = useRef(null);

  useEffect(() => () => {
    if (successDismissTimer.current) clearTimeout(successDismissTimer.current);
  }, []);

  const logout = () => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(""); setProfile(null);
    setProfileLoading(false); setProfileError(null);
    setLoginStep("phone"); setPhone(""); setCode("");
    setLoginMsg({ text: "", isErr: false });
  };

  const loadProfile = useCallback(async t => {
    if (!t) return;
    setProfileLoading(true);
    setProfileError(null);
    try {
      const me = await fetchMyProfile(t);
      setProfile(me);
      const pl = me.approved_upload_platforms || [];
      if (pl.length > 0) setPlatform(pl[0]);
    } catch (e) {
      // Only logout on 401 (token actually invalid/expired).
      // Network errors or 5xx (backend restart) should NOT clear the token.
      if (e?.status === 401) {
        localStorage.removeItem(TOKEN_KEY);
        setToken(""); setProfile(null);
      } else {
        const msg =
          e?.message ||
          "Could not reach the server. If you use ngrok, confirm the tunnel is running.";
        setProfileError(msg);
      }
    } finally {
      setProfileLoading(false);
    }
  }, []);

  useEffect(() => { if (token) loadProfile(token); else setProfile(null); }, [token, loadProfile]);

  const phoneReady = phone.replace(/\D/g, "").length === 10;
  const codeReady  = code.trim().length === 6;

  async function onSendOTP() {
    setLoginBusy(true); setLoginMsg({ text: "", isErr: false });
    try {
      await otpSend(phone.replace(/\D/g, ""));
      setLoginMsg({ text: `OTP sent to ${maskPhone(phone)}`, isErr: false });
      setLoginStep("otp");
    } catch (e) { setLoginMsg({ text: e?.message || "Could not send OTP.", isErr: true }); }
    finally { setLoginBusy(false); }
  }

  async function onVerifyOTP() {
    setLoginBusy(true); setLoginMsg({ text: "", isErr: false });
    try {
      const r = await otpVerify(phone.replace(/\D/g, ""), code.trim());
      const access = r?.tokens?.access;
      if (!access) throw new Error("Login failed. Please try again.");
      localStorage.setItem(TOKEN_KEY, access);
      setToken(access);
      await loadProfile(access);
    } catch (e) { setLoginMsg({ text: e?.message || "Invalid code. Try again.", isErr: true }); }
    finally { setLoginBusy(false); }
  }

  async function onResendOTP() {
    setLoginBusy(true);
    try { await otpResend(phone.replace(/\D/g, "")); setLoginMsg({ text: "New OTP sent!", isErr: false }); }
    catch (e) { setLoginMsg({ text: e?.message || "Could not resend.", isErr: true }); }
    finally { setLoginBusy(false); }
  }

  async function uploadThumbs(seriesId) {
    for (const [file, kind] of [[cardThumb, "card"], [heroThumb, "hero"]]) {
      if (!file) continue;
      const p = await shortfilmThumbnailPresign(token, {
        series_id: seriesId,
        platform,
        kind,
        content_type: file.type || THUMB_MIME,
      });
      await s3Put(p.upload_url, file, file.type || THUMB_MIME);
    }
  }

  async function onSubmit() {
    if (!videoFile) { setUploadMsg("Please choose a short film file."); return; }
    if (!title.trim()) { setUploadMsg("Please enter the title."); return; }
    if (!description.trim()) { setUploadMsg("Please enter a description."); return; }
    if (!mood) { setUploadMsg("Please choose a category."); return; }
    if (!cardThumb || !heroThumb) {
      setUploadMsg("Please add both thumbnails — card and hero banner.");
      return;
    }

    if (successDismissTimer.current) {
      clearTimeout(successDismissTimer.current);
      successDismissTimer.current = null;
    }

    setUploadBusy(true);
    setUploadMsg("Starting upload…");
    setUploadProgress(null);
    setUploadDone(false);

    try {
      const useChunked = videoFile.size >= MULTIPART_THRESHOLD;

      // ── Step 1: Init upload on backend ──
      setUploadMsg("Registering upload with server…");
      const startPayload = {
        platform,
        title: title.trim(),
        description: description.trim(),
        mood,
        file_name: videoFile.name,
        content_type: videoFile.type || "video/mp4",
        file_size: videoFile.size,
        prefer_chunked: useChunked,
        is_premium: isPremium,
        premium_price: isPremium ? premiumCoins : null,
      };

      const start = await shortfilmUploadStart(token, startPayload);

      // ── Upload video first so S3 CompleteMultipart / PUT can fire Lambda without waiting on images ──
      if (start.upload_mode === "multipart" && start.multipart) {
        setUploadMsg("Uploading video — 0%");
        setUploadProgress(0.01);
        const mp = start.multipart;
        const totalParts = mp.total_parts || mp.presigned_urls?.length || mp.urls?.length || 0;

        const parts = await uploadFileMultipart(videoFile, mp, p => {
          setUploadProgress(Math.max(0.01, p));
          setUploadMsg(`Uploading video — ${Math.round(p * 100)}%`);
        });

        setUploadMsg("Finalising upload…");
        await shortfilmMultipartComplete(token, {
          video_upload_id: start.video_upload_id,
          upload_id: start.upload_id,
          s3_key: start.s3_key,
          parts,
        });
        setUploadProgress(1);
      } else {
        setUploadMsg("Uploading video — 0%");
        setUploadProgress(0.05);
        await s3Put(start.upload_url, videoFile, videoFile.type || "video/mp4");
        setUploadMsg("Finalising upload…");
        await shortfilmUploadComplete(token, {
          video_upload_id: start.video_upload_id,
          s3_key: start.s3_key,
        });
        setUploadProgress(1);
      }

      setUploadMsg("Uploading thumbnails…");
      await uploadThumbs(start.series_id);

      setUploadProgress(null);
      setUploadMsg("Upload complete! Your short film is being processed — HD will be ready shortly.");
      setUploadDone(true);

      setTitle(""); setDescription(""); setMood("feel-good"); setVideoFile(null); setCardThumb(null); setHeroThumb(null);
      setIsPremium(false); setPremiumCoins(10);
      setFilePickEpoch(k => k + 1);

      successDismissTimer.current = setTimeout(() => {
        setUploadMsg("");
        setUploadDone(false);
        successDismissTimer.current = null;
      }, 5000);

    } catch (e) {
      const errMsg = e?.message || "Something went wrong. Please try again.";
      setUploadProgress(null);
      setUploadMsg(errMsg);
      console.error("[onSubmit] Upload failed:", e);
    } finally {
      setUploadBusy(false);
    }
  }


  const approvedPlatforms = profile?.approved_upload_platforms || [];
  const canUpload = !!(profile?.can_upload_content && approvedPlatforms.length > 0);

  const uploadReady =
    !!videoFile &&
    !!title.trim() &&
    !!description.trim() &&
    !!mood &&
    !!cardThumb &&
    !!heroThumb;

  return (
    <div className="sf-shell">
      {/* ── HEADER ── */}
      <header className="sf-header">
        <div className="sf-brand">
          <div className="sf-logo-box"><img src="/logo.png" alt="" /></div>
          <div>
            <div className="sf-wordmark">Snoozeit</div>
            <div className="sf-subtitle">Creator Portal</div>
          </div>
        </div>
        {token && profile && (
          <ProfilePopup profile={profile} approvedPlatforms={approvedPlatforms} onLogout={logout} />
        )}
        {token && profileLoading && (
          <div className="sf-header-status" aria-busy="true">
            <span className="sf-spinner sf-spinner-header" />
            <span>Profile</span>
          </div>
        )}
      </header>

      <main className={`sf-main ${!token ? "sf-main-auth" : ""}`}>

        {/* ══ AUTH ══ */}
        {!token && (
          <div className="sf-auth-wrap">
            <h1 className="sf-page-title">Upload Short Film</h1>
            <p className="sf-page-sub">Sign in with your Snoozeit creator number</p>
            <div className="sf-login-card">

              {loginStep === "phone" && <>
                <div className="sf-field">
                  <label htmlFor="phone">Mobile number</label>
                  <input id="phone" className="sf-input" inputMode="numeric" autoComplete="tel"
                    placeholder="10-digit number" maxLength={10} value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, "").slice(0, 10))}
                    onKeyDown={e => e.key === "Enter" && phoneReady && !loginBusy && onSendOTP()} />
                </div>
                {loginMsg.text && <p className={`sf-card-msg ${loginMsg.isErr ? "is-err" : ""}`}>{loginMsg.text}</p>}
                <button type="button" className="sf-btn sf-btn-primary sf-btn-full"
                  disabled={loginBusy || !phoneReady} onClick={onSendOTP}>
                  {loginBusy ? "Sending…" : "Send OTP"}
                </button>
              </>}

              {loginStep === "otp" && <>
                <div className="sf-otp-row">
                  <div>
                    <p className="sf-otp-label">Enter OTP</p>
                    {loginMsg.text && <p className={`sf-card-msg ${loginMsg.isErr ? "is-err" : ""}`}>{loginMsg.text}</p>}
                  </div>
                  <button type="button" className="sf-link" disabled={loginBusy}
                    onClick={() => { setCode(""); setLoginStep("phone"); setLoginMsg({ text: "", isErr: false }); }}>
                    Change number
                  </button>
                </div>
                <div className="sf-field">
                  <label htmlFor="otp">6-digit code</label>
                  <input id="otp" className="sf-input sf-input-otp" inputMode="numeric"
                    autoComplete="one-time-code" placeholder="• • • • • •" maxLength={6} value={code}
                    onChange={e => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                    onKeyDown={e => e.key === "Enter" && codeReady && !loginBusy && onVerifyOTP()} />
                </div>
                <button type="button" className="sf-btn sf-btn-primary sf-btn-full"
                  disabled={loginBusy || !codeReady} onClick={onVerifyOTP}>
                  {loginBusy ? "Verifying…" : "Continue"}
                </button>
                <button type="button" className="sf-btn sf-btn-ghost sf-btn-full"
                  disabled={loginBusy} onClick={onResendOTP}>
                  Resend OTP
                </button>
              </>}
            </div>
          </div>
        )}

        {/* ══ LOGGED IN ══ */}
        {token && (
          <div className="sf-content">
            <h1 className="sf-page-title">Upload Short Film</h1>

            {profileLoading && (
              <div className="sf-profile-panel sf-profile-panel-loading">
                <span className="sf-spinner sf-spinner-lg" />
                <p className="sf-profile-panel-title">Loading your profile…</p>
                <p className="sf-profile-panel-sub">Connecting to the server</p>
              </div>
            )}

            {!profileLoading && profileError && (
              <div className="sf-profile-panel sf-profile-panel-error">
                <p className="sf-profile-panel-title">Could not load profile</p>
                <p className="sf-profile-panel-sub">{profileError}</p>
                <button type="button" className="sf-btn sf-btn-primary" onClick={() => loadProfile(token)}>
                  Try again
                </button>
                <p className="sf-profile-panel-hint">
                  For local development, set <code className="sf-code">API_URL=http://127.0.0.1:8000</code> in{" "}
                  <code className="sf-code">.env</code> (and restart server).
                </p>
              </div>
            )}

            {/* No permission */}
            {!profileLoading && !profileError && !canUpload && profile && (
              <div className="sf-gate">
                <div className="sf-gate-icon">🔒</div>
                <p className="sf-gate-title">Upload access required</p>
                <p className="sf-gate-text">Your account hasn't been approved for uploads yet. Contact the Snoozeit team or check your approval status in the app.</p>
              </div>
            )}

            {/* Upload form */}
            {!profileLoading && !profileError && canUpload && (
              <div className="sf-upload-card">

                {/* Platform + Title */}
                <div className="sf-grid-2">
                  <div className="sf-field">
                    <label htmlFor="platform">Platform</label>
                    <select id="platform" className="sf-input" value={platform} onChange={e => setPlatform(e.target.value)}>
                      {ALL_PLATFORMS.map(pl => {
                        const approved = approvedPlatforms.includes(pl);
                        return (
                          <option key={pl} value={pl} disabled={!approved}>
                            {PL_LABEL[pl]}{!approved ? " (LOCKED)" : ""}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                  <div className="sf-field">
                    <label htmlFor="title">Title <span className="sf-req">*</span></label>
                    <input id="title" className="sf-input" placeholder="Name of the short film"
                      value={title} onChange={e => setTitle(e.target.value)} />
                  </div>
                </div>

                {/* Description */}
                <div className="sf-field">
                  <label htmlFor="desc">Description <span className="sf-req">*</span></label>
                  <textarea id="desc" className="sf-input sf-textarea" rows={3}
                    placeholder="Short description for the catalogue"
                    value={description} onChange={e => setDescription(e.target.value)} />
                </div>

                {/* Category */}
                <div className="sf-field">
                  <label htmlFor="mood">Category <span className="sf-req">*</span></label>
                  <select id="mood" className="sf-input" value={mood} onChange={e => setMood(e.target.value)}>
                    {MOODS.map(m => (
                      <option key={m.value} value={m.value}>{m.label}</option>
                    ))}
                  </select>
                </div>

                {/* Video file — key resets native input after each successful upload */}
                <FilePick key={`video-${filePickEpoch}`} id="video" accept="video/mp4,video/quicktime,video/*"
                  label={<>Short Film File <span className="sf-req">*</span></>}
                  hint="MP4 or MOV · Max file size: 5 GB"
                  file={videoFile} onFile={setVideoFile} />

                {/* Thumbnails */}
                <div className="sf-grid-2">
                  <FilePick key={`card-${filePickEpoch}`} id="card-thumb" accept="image/*"
                    label={<>Short Film Card Thumbnail <span className="sf-req">*</span></>}
                    tooltip="Shown on the browse catalogue. Ratio 2:3 — auto-cropped to 800 × 1200 px."
                    file={cardThumb} onFile={setCardThumb}
                    cropW={800} cropH={1200} />
                  <FilePick key={`hero-${filePickEpoch}`} id="hero-thumb" accept="image/*"
                    label={<>Hero Banner <span className="sf-req">*</span></>}
                    tooltip="Detail page banner. Ratio 1:1 — auto-cropped to 1024 × 1024 px."
                    file={heroThumb} onFile={setHeroThumb}
                    cropW={1024} cropH={1024} />
                </div>

                {/* Premium toggle */}
                <div className="sf-premium-section">
                  <label className="sf-toggle-label">
                    <input type="checkbox" className="sf-toggle-input" checked={isPremium}
                      onChange={e => setIsPremium(e.target.checked)} />
                    <div className="sf-toggle-track"><div className="sf-toggle-thumb" /></div>
                    <div className="sf-toggle-copy">
                      <span className="sf-toggle-title">Mark as Premium</span>
                      <p className="sf-toggle-desc">Viewers pay coins to unlock.</p>
                    </div>
                  </label>

                  {isPremium && (
                    <div className="sf-coins-row">
                      <label htmlFor="coins" className="sf-coins-label">
                        Unlock price <span className="sf-coins-unit">coins</span>
                        <span className="sf-coins-max">max {MAX_COINS}</span>
                      </label>
                      <div className="sf-coins-input-wrap">
                        <button type="button" className="sf-coins-btn"
                          onClick={() => setPremiumCoins(v => Math.max(1, v - 1))}>−</button>
                        <input id="coins" type="number" className="sf-coins-input"
                          min={1} max={MAX_COINS} value={premiumCoins}
                          onChange={e => setPremiumCoins(Math.min(MAX_COINS, Math.max(1, parseInt(e.target.value) || 1)))} />
                        <button type="button" className="sf-coins-btn"
                          onClick={() => setPremiumCoins(v => Math.min(MAX_COINS, v + 1))}>+</button>
                      </div>
                    </div>
                  )}
                </div>

                {/* Status + progress */}
                {uploadMsg && (
                  <div className={`sf-upload-status ${uploadDone ? "is-done" : ""}`}>
                    {uploadDone && <span className="sf-done-check">✓</span>}
                    <span>{uploadMsg}</span>
                  </div>
                )}
                {uploadProgress != null && (
                  <div className="sf-progress-track">
                    <div className="sf-progress-fill" style={{ width: `${Math.round(uploadProgress * 100)}%` }} />
                  </div>
                )}

                <div className="sf-submit-row">
                  <button type="button" className="sf-btn sf-btn-primary sf-btn-upload"
                    disabled={uploadBusy || !uploadReady} onClick={onSubmit}>
                    {uploadBusy ? <><span className="sf-spinner" /> Uploading…</> : "Upload Short Film"}
                  </button>
                </div>

              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
