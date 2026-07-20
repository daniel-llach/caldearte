"use client";

import { useState } from "react";
import { esCL } from "@/i18n/es-CL";
import { resolveCardImage, PLACEHOLDER_BG } from "@/lib/image-source";

interface CardImageProps {
  imageUrl: string | null;
  sourceUrl: string | null;
  sensitivityTags: string[];
}

export default function CardImage({ imageUrl, sourceUrl, sensitivityTags }: CardImageProps) {
  const [revealed, setRevealed] = useState(false);
  const sensitive = sensitivityTags.length > 0;
  const image = resolveCardImage({ imageUrl, sourceUrl });
  const blurClass = sensitive && !revealed ? "blur-xl scale-110" : "";

  return (
    <div className="relative w-full h-full overflow-hidden bg-stone-800">
      {image.type === "photo" ? (
        // eslint-disable-next-line @next/next/no-img-element -- external, unoptimized scraped URLs, see next.config.ts
        <img src={image.url} alt="" className={`w-full h-full object-cover transition-[filter] duration-300 ${blurClass}`} />
      ) : (
        <div
          className={`w-full h-full bg-cover bg-center transition-[filter] duration-300 ${blurClass}`}
          style={{ backgroundImage: `url(${PLACEHOLDER_BG[image.source]})` }}
        >
          {image.source === "web" && image.domain && (
            <div className="absolute inset-x-0 bottom-3 flex justify-center">
              <span className="text-[11px] font-semibold text-white bg-black/50 rounded-[10px] px-2 py-1">{image.domain}</span>
            </div>
          )}
        </div>
      )}

      {sensitive && !revealed && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-xl flex items-center justify-center">
          <div className="flex flex-col items-center gap-2 bg-black/40 rounded-[20px] px-5 py-4">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/eye-off.svg" alt="" width={20} height={20} />
            <p className="text-[13px] font-semibold text-white">{esCL.sensitiveOverlay.label}</p>
            <button
              onClick={(ev) => {
                ev.preventDefault();
                ev.stopPropagation();
                setRevealed(true);
              }}
              className="text-[12px] font-semibold text-white border border-white rounded-full px-3 py-1.5"
            >
              {esCL.sensitiveOverlay.reveal}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
