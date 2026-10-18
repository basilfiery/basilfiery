/**
 * Cena escura da tela de acesso: mesa com cartão, pilhas de moedas, planta e um
 * tablet mostrando o faturamento — tudo em vetor (carrega na hora, sem foto pesada).
 */
export function CenaMesa() {
  const pilha = (x: number, base: number, qtd: number, larg = 46) =>
    Array.from({ length: qtd }, (_, i) => {
      const y = base - i * 7;
      return (
        <g key={i}>
          <path d={`M${x - larg / 2} ${y} v6 a${larg / 2} 8 0 0 0 ${larg} 0 v-6`} fill="url(#moedaLado)" />
          <ellipse cx={x} cy={y} rx={larg / 2} ry={8} fill="url(#moedaTopo)" stroke="#1d7a4f" strokeOpacity={i === qtd - 1 ? 0.55 : 0.18} strokeWidth={0.8} />
        </g>
      );
    });

  return (
    <svg className="dn-cena" viewBox="0 0 390 560" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <defs>
        <radialGradient id="fundo" cx="62%" cy="38%" r="75%">
          <stop offset="0" stopColor="#1f2420" />
          <stop offset="0.55" stopColor="#111312" />
          <stop offset="1" stopColor="#0a0a0a" />
        </radialGradient>
        <linearGradient id="mesa" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#151716" />
          <stop offset="1" stopColor="#0b0c0b" />
        </linearGradient>
        <linearGradient id="moedaTopo" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#8a7748" />
          <stop offset="0.5" stopColor="#5a4c2c" />
          <stop offset="1" stopColor="#2f2817" />
        </linearGradient>
        <linearGradient id="moedaLado" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0" stopColor="#2a2414" />
          <stop offset="0.45" stopColor="#6b5a33" />
          <stop offset="0.8" stopColor="#3a3119" />
          <stop offset="1" stopColor="#1a7a4c" stopOpacity="0.7" />
        </linearGradient>
        <linearGradient id="cartao" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#2a2c2b" />
          <stop offset="1" stopColor="#0e0f0f" />
        </linearGradient>
        <linearGradient id="folha" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#24402f" />
          <stop offset="1" stopColor="#0c1912" />
        </linearGradient>
        <linearGradient id="sombraBaixo" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0.45" stopColor="#0a0a0a" stopOpacity="0" />
          <stop offset="1" stopColor="#0a0a0a" />
        </linearGradient>
        <radialGradient id="brilhoVerde" cx="50%" cy="50%" r="50%">
          <stop offset="0" stopColor="#12b76a" stopOpacity="0.55" />
          <stop offset="1" stopColor="#12b76a" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect width="390" height="560" fill="url(#fundo)" />

      {/* Planta */}
      <g opacity="0.95">
        <path d="M300 300 C 300 250, 315 230, 330 228 L 362 228 C 372 240, 372 290, 368 300 Z" fill="#141615" />
        {[
          'M338 230 C 320 180, 300 150, 270 140 C 300 170, 318 200, 333 232 Z',
          'M342 230 C 345 170, 360 130, 390 100 C 372 145, 360 190, 348 232 Z',
          'M336 232 C 300 215, 268 214, 240 228 C 276 226, 305 232, 334 238 Z',
          'M346 232 C 372 200, 395 190, 420 192 C 395 205, 372 220, 350 238 Z',
          'M340 228 C 334 175, 336 140, 350 110 C 352 150, 348 190, 344 230 Z',
        ].map((d, i) => <path key={i} d={d} fill="url(#folha)" stroke="#2f6b49" strokeOpacity="0.35" strokeWidth="0.8" />)}
      </g>

      {/* Mesa */}
      <path d="M0 330 L390 300 L390 560 L0 560 Z" fill="url(#mesa)" />

      {/* Pilhas de moedas */}
      <ellipse cx="262" cy="350" rx="80" ry="14" fill="#000" opacity="0.5" />
      {pilha(230, 352, 9)}
      {pilha(285, 346, 13)}
      {pilha(325, 356, 6, 42)}
      {pilha(262, 372, 4, 40)}

      {/* Cartão */}
      <g transform="translate(60 268) rotate(-8)">
        <rect width="150" height="92" rx="9" fill="url(#cartao)" stroke="#3a3d3b" strokeWidth="0.8" />
        <rect x="104" y="40" width="20" height="15" rx="3" fill="#8b7a4f" opacity="0.85" />
        <path d="M130 44 a6 6 0 0 1 0 8 M134 41 a10 10 0 0 1 0 14" stroke="#777" strokeWidth="1.2" fill="none" />
      </g>

      {/* Tablet com o faturamento */}
      <g transform="translate(-10 420) rotate(-12)">
        <rect width="170" height="110" rx="12" fill="#101211" stroke="#2a2d2b" strokeWidth="1" />
        <circle cx="48" cy="56" r="34" fill="url(#brilhoVerde)" />
        <circle cx="48" cy="56" r="20" fill="none" stroke="#12b76a" strokeWidth="4" strokeDasharray="88 40" strokeLinecap="round" />
        <path d="M86 78 l14 -14 l12 8 l20 -24 l14 10" stroke="#12b76a" strokeWidth="2" fill="none" strokeLinecap="round" strokeLinejoin="round" opacity="0.8" />
      </g>

      {/* Caneta e caderno */}
      <g transform="translate(250 430) rotate(18)">
        <rect width="150" height="96" rx="6" fill="#121413" stroke="#262928" strokeWidth="0.8" />
        {[0, 1, 2, 3, 4, 5, 6].map((i) => <circle key={i} cx={10} cy={12 + i * 12} r="2.4" fill="#2c2f2d" />)}
      </g>
      <rect x="240" y="395" width="120" height="5" rx="2.5" fill="#1c1e1d" transform="rotate(26 240 395)" />

      <rect width="390" height="560" fill="url(#sombraBaixo)" />
    </svg>
  );
}
