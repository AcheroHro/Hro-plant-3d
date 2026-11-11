import React from 'react';
import { PieceIconKind } from '../../core/specs/paletteItems';

/** Tres tonos por familia de pieza: borde, cuerpo y brillo */
interface Tone {
  edge: string;
  body: string;
  light: string;
}

const STEEL: Tone = { edge: '#0b2a3d', body: '#3f8fb8', light: '#bfe6fa' };
const ELBOW: Tone = { edge: '#06302a', body: '#2f9e7f', light: '#b6f2dd' };
const TEE: Tone = { edge: '#3a2804', body: '#c98a1b', light: '#fde3a1' };
const REDUCER: Tone = { edge: '#053540', body: '#1ea5b8', light: '#b9f1f8' };
const FLANGE: Tone = { edge: '#2a1648', body: '#8b5fd0', light: '#e3d4fb' };
const VALVE: Tone = { edge: '#47101f', body: '#d6506f', light: '#ffd0da' };
const CLOSE: Tone = { edge: '#1c2530', body: '#7d8b9c', light: '#e3e9f0' };

const TONE: Record<PieceIconKind, Tone> = {
  pipe: STEEL,
  coupling: STEEL,
  elbow90: ELBOW,
  elbow45: ELBOW,
  elbowStreet: ELBOW,
  teeRun: TEE,
  teeBranch: TEE,
  teeReducing: TEE,
  olet: TEE,
  reducerConcentric: REDUCER,
  reducerEccentric: REDUCER,
  flangeWN: FLANGE,
  flangeSO: FLANGE,
  flangeBlind: CLOSE,
  flangePair: FLANGE,
  valveGate: VALVE,
  valveGlobe: VALVE,
  valveBall: VALVE,
  valveCheck: VALVE,
  valveButterfly: VALVE,
  valvePlug: VALVE,
  valve: VALVE,
  cap: CLOSE
};

/** Tubo visto de costado: borde oscuro, cuerpo y una línea de brillo arriba */
const Tube: React.FC<{ d: string; w?: number; t: Tone; cap?: 'butt' | 'round' }> = ({ d, w = 8, t, cap = 'butt' }) => (
  <>
    <path d={d} fill="none" stroke={t.edge} strokeWidth={w} strokeLinecap={cap} strokeLinejoin="round" />
    <path d={d} fill="none" stroke={t.body} strokeWidth={w - 2} strokeLinecap={cap} strokeLinejoin="round" />
    <path d={d} fill="none" stroke={t.light} strokeWidth={Math.max(1, w * 0.18)} strokeLinecap={cap} strokeLinejoin="round" opacity={0.75} transform={`translate(-0.6 -${(w * 0.2).toFixed(2)})`} />
  </>
);

/** Pieza maciza: polígono con borde y una franja de brillo */
const Solid: React.FC<{ points: string; t: Tone; shine?: string }> = ({ points, t, shine }) => (
  <>
    <polygon points={points} fill={t.body} stroke={t.edge} strokeWidth={1.1} strokeLinejoin="round" />
    {shine && <polyline points={shine} fill="none" stroke={t.light} strokeWidth={1.4} strokeLinecap="round" opacity={0.8} />}
  </>
);

/** Disco de brida de canto, con su resalto hacia `face` (-1 izquierda, 1 derecha) */
const Disc: React.FC<{ x: number; t: Tone; w?: number; face?: -1 | 0 | 1 }> = ({ x, t, w = 4, face = 1 }) => (
  <>
    {face !== 0 && <rect x={face === 1 ? x + w : x - 1.6} y={6.5} width={1.6} height={11} fill={t.light} stroke={t.edge} strokeWidth={0.6} />}
    <rect x={x} y={2} width={w} height={20} rx={0.8} fill={t.body} stroke={t.edge} strokeWidth={1.1} />
    <line x1={x + 1.2} y1={3.5} x2={x + 1.2} y2={20.5} stroke={t.light} strokeWidth={1} opacity={0.8} />
  </>
);

/** Extremos bridados y cuerpo de moño de una válvula */
const ValveBody: React.FC<{ t: Tone; ends?: boolean }> = ({ t, ends = true }) => (
  <>
    <Tube d="M1 15 H5" w={6} t={STEEL} />
    <Tube d="M27 15 H31" w={6} t={STEEL} />
    <polygon points="6,9.5 16,15 6,20.5" fill={t.body} stroke={t.edge} strokeWidth={1.1} strokeLinejoin="round" />
    <polygon points="26,9.5 16,15 26,20.5" fill={t.body} stroke={t.edge} strokeWidth={1.1} strokeLinejoin="round" />
    <polyline points="7.4,12 12.5,14.4" fill="none" stroke={t.light} strokeWidth={1.2} strokeLinecap="round" opacity={0.85} />
    {ends && (
      <>
        <rect x={4.4} y={8} width={2} height={14} rx={0.5} fill={t.light} stroke={t.edge} strokeWidth={0.8} />
        <rect x={25.6} y={8} width={2} height={14} rx={0.5} fill={t.light} stroke={t.edge} strokeWidth={0.8} />
      </>
    )}
  </>
);

const Wheel: React.FC<{ t: Tone }> = ({ t }) => (
  <>
    <line x1={16} y1={15} x2={16} y2={4.5} stroke={t.edge} strokeWidth={1.8} />
    <rect x={9.5} y={2.2} width={13} height={2.8} rx={1.4} fill={t.light} stroke={t.edge} strokeWidth={0.9} />
  </>
);

const Lever: React.FC<{ t: Tone }> = ({ t }) => (
  <>
    <line x1={16} y1={15} x2={16} y2={6} stroke={t.edge} strokeWidth={1.8} />
    <rect x={14.5} y={3.6} width={14} height={2.6} rx={1.3} fill={t.light} stroke={t.edge} strokeWidth={0.9} />
  </>
);

function draw(kind: PieceIconKind, t: Tone): React.ReactNode {
  switch (kind) {
    case 'pipe':
      return (
        <>
          <Tube d="M2 12 H29" w={9} t={t} />
          <ellipse cx={29} cy={12} rx={1.8} ry={4.5} fill={t.edge} stroke={t.light} strokeWidth={0.8} />
        </>
      );
    case 'coupling':
      return (
        <>
          <Tube d="M1 12 H31" w={7} t={t} />
          <rect x={9} y={5.5} width={14} height={13} rx={1.5} fill={t.body} stroke={t.edge} strokeWidth={1.1} />
          <line x1={10.5} y1={8} x2={21.5} y2={8} stroke={t.light} strokeWidth={1.3} strokeLinecap="round" opacity={0.85} />
          <line x1={16} y1={5.5} x2={16} y2={18.5} stroke={t.edge} strokeWidth={0.7} opacity={0.6} />
        </>
      );
    case 'elbow90':
      return <Tube d="M3 19 H12 A10 10 0 0 0 22 9 V2" w={8} t={t} />;
    case 'elbow45':
      return <Tube d="M2 18 H11 Q15.5 18 18.5 15 L28 5.5" w={8} t={t} />;
    case 'elbowStreet':
      return (
        <>
          <Tube d="M3 19 H12 A10 10 0 0 0 22 9 V2" w={7} t={t} />
          <rect x={16.5} y={1.5} width={11} height={5} rx={1} fill={t.body} stroke={t.edge} strokeWidth={1.1} />
          <line x1={18} y1={3} x2={26} y2={3} stroke={t.light} strokeWidth={1} opacity={0.8} />
        </>
      );
    case 'teeRun':
      return (
        <>
          <Tube d="M16 15 V2" w={8} t={t} />
          <Tube d="M2 16 H30" w={8} t={t} />
          <polyline points="24,12.8 28,16 24,19.2" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'teeBranch':
      return (
        <>
          <Tube d="M16 15 V2" w={8} t={t} />
          <Tube d="M2 16 H30" w={8} t={t} />
          <polyline points="12.8,7 16,3 19.2,7" fill="none" stroke="#fff" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'teeReducing':
      return (
        <>
          <Tube d="M16 15 V2" w={5} t={t} />
          <Tube d="M2 16 H30" w={9} t={t} />
        </>
      );
    case 'olet':
      return (
        <>
          <Tube d="M2 17 H30" w={9} t={STEEL} />
          <Solid points="11.5,13 13.5,6 18.5,6 20.5,13" t={t} shine="13.6,11.5 14.6,7.6" />
          <rect x={13} y={3} width={6} height={3.2} rx={0.6} fill={t.light} stroke={t.edge} strokeWidth={0.9} />
        </>
      );
    case 'reducerConcentric':
      return (
        <>
          <Solid points="3,3.5 12,3.5 21,8 29,8 29,16 21,16 12,20.5 3,20.5" t={t} shine="4.5,6 11.6,6 20.6,10.2 27.5,10.2" />
          <line x1={1} y1={12} x2={31} y2={12} stroke={t.edge} strokeWidth={0.7} strokeDasharray="2.5 1.8" opacity={0.7} />
        </>
      );
    case 'reducerEccentric':
      return (
        <>
          <Solid points="3,3.5 12,3.5 21,12.5 29,12.5 29,20.5 3,20.5" t={t} shine="4.5,6 11.2,6 20.2,15 27.5,15" />
          <line x1={2} y1={22.6} x2={30} y2={22.6} stroke={t.light} strokeWidth={1.3} strokeLinecap="round" />
        </>
      );
    case 'flangeWN':
      return (
        <>
          <Tube d="M1 12 H11" w={8} t={STEEL} />
          <Solid points="10.5,8 18.5,5 18.5,19 10.5,16" t={t} shine="11.8,9.2 17.2,7.2" />
          <Disc x={18} t={t} />
        </>
      );
    case 'flangeSO':
      return (
        <>
          <Tube d="M1 12 H20" w={8} t={STEEL} />
          <rect x={13.5} y={6} width={5} height={12} rx={0.8} fill={t.body} stroke={t.edge} strokeWidth={1.1} />
          <Disc x={18} t={t} />
        </>
      );
    case 'flangeBlind':
      return (
        <>
          <Disc x={13} t={t} w={6} face={-1} />
          <circle cx={16} cy={5.5} r={1} fill={t.edge} />
          <circle cx={16} cy={18.5} r={1} fill={t.edge} />
          <line x1={22.5} y1={4} x2={22.5} y2={20} stroke={t.light} strokeWidth={1.4} strokeLinecap="round" opacity={0.55} />
        </>
      );
    case 'flangePair':
      return (
        <>
          <Tube d="M1 12 H9" w={7} t={STEEL} />
          <Tube d="M23 12 H31" w={7} t={STEEL} />
          <Solid points="8,8.5 11.5,6.5 11.5,17.5 8,15.5" t={t} />
          <Solid points="24,8.5 20.5,6.5 20.5,17.5 24,15.5" t={t} />
          <Disc x={11} t={t} w={3.6} face={0} />
          <Disc x={17.4} t={t} w={3.6} face={0} />
          <rect x={15.2} y={4.5} width={1.6} height={15} fill="#f8fafc" stroke={t.edge} strokeWidth={0.5} />
        </>
      );
    case 'valveGate':
      return (
        <>
          <Wheel t={t} />
          <ValveBody t={t} />
        </>
      );
    case 'valveGlobe':
      return (
        <>
          <Wheel t={t} />
          <ValveBody t={t} />
          <circle cx={16} cy={15} r={3.6} fill={t.edge} stroke={t.light} strokeWidth={0.9} />
        </>
      );
    case 'valveBall':
      return (
        <>
          <Lever t={t} />
          <ValveBody t={t} />
          <circle cx={16} cy={15} r={3.8} fill={t.light} stroke={t.edge} strokeWidth={1.1} />
        </>
      );
    case 'valvePlug':
      return (
        <>
          <Lever t={t} />
          <ValveBody t={t} />
          <polygon points="13.2,11.5 18.8,11.5 17.6,18.5 14.4,18.5" fill={t.light} stroke={t.edge} strokeWidth={1} strokeLinejoin="round" />
        </>
      );
    case 'valveCheck':
      return (
        <>
          <Tube d="M1 14 H5" w={6} t={STEEL} />
          <Tube d="M27 14 H31" w={6} t={STEEL} />
          <rect x={4.4} y={7} width={2} height={14} rx={0.5} fill={t.light} stroke={t.edge} strokeWidth={0.8} />
          <rect x={25.6} y={7} width={2} height={14} rx={0.5} fill={t.light} stroke={t.edge} strokeWidth={0.8} />
          <path d="M6.4 9.5 H25.6 V18.5 H6.4 Z M11 9.5 Q16 2.5 21 9.5" fill={t.body} stroke={t.edge} strokeWidth={1.1} strokeLinejoin="round" />
          <line x1={13} y1={10.5} x2={19.5} y2={17.5} stroke={t.light} strokeWidth={1.8} strokeLinecap="round" />
          <line x1={8.5} y1={14} x2={12} y2={14} stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
          <line x1={20.5} y1={14} x2={23.5} y2={14} stroke="#fff" strokeWidth={1.2} strokeLinecap="round" />
          <polyline points="21.8,12.2 23.8,14 21.8,15.8" fill="none" stroke="#fff" strokeWidth={1.2} strokeLinecap="round" strokeLinejoin="round" />
        </>
      );
    case 'valveButterfly':
      return (
        <>
          <Tube d="M1 15 H11" w={6} t={STEEL} />
          <Tube d="M21 15 H31" w={6} t={STEEL} />
          <line x1={16} y1={15} x2={16} y2={6} stroke={t.edge} strokeWidth={1.8} />
          <rect x={14.5} y={3.6} width={14} height={2.6} rx={1.3} fill={t.light} stroke={t.edge} strokeWidth={0.9} />
          <rect x={11} y={7.5} width={10} height={15} rx={1.5} fill={t.body} stroke={t.edge} strokeWidth={1.1} />
          <line x1={12.8} y1={20} x2={19.2} y2={10} stroke={t.light} strokeWidth={2} strokeLinecap="round" />
          <circle cx={16} cy={15} r={1.3} fill={t.edge} />
        </>
      );
    case 'valve':
      return (
        <>
          <line x1={16} y1={15} x2={16} y2={5} stroke={t.edge} strokeWidth={1.8} />
          <line x1={11} y1={4.5} x2={21} y2={4.5} stroke={t.edge} strokeWidth={2.2} strokeLinecap="round" />
          <ValveBody t={t} ends={false} />
        </>
      );
    case 'cap':
      return (
        <>
          <Tube d="M1 12 H13" w={9} t={STEEL} />
          <path d="M13 7 H16 A8 5.6 0 0 1 16 17 H13 Z" fill={t.body} stroke={t.edge} strokeWidth={1.1} strokeLinejoin="round" />
          <path d="M14.2 8.6 H16 A6 4 0 0 1 20 10" fill="none" stroke={t.light} strokeWidth={1.2} strokeLinecap="round" opacity={0.85} />
        </>
      );
  }
}

/** Ícono de una pieza de la paleta: vista lateral sombreada, mismo trazo en todo el juego */
export const PieceIcon: React.FC<{ kind: PieceIconKind; className?: string }> = ({ kind, className }) => (
  <svg viewBox="0 0 32 24" className={className} aria-hidden="true" focusable="false">
    {draw(kind, TONE[kind])}
  </svg>
);
