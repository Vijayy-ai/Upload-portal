import React from "react";

export default function Card({ variant, className = "", ...props }) {
  const variantClass = variant ? `snooze-card--${variant}` : "";
  return <div className={`snooze-card ${variantClass} ${className}`.trim()} {...props} />;
}

