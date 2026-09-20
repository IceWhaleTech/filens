export type GeometryValue = number | string | GeometryExpression;

export type GeometryExpression =
  | {
      type: 'add';
      values: GeometryValue[];
    }
  | {
      type: 'sub';
      left: GeometryValue;
      right: GeometryValue;
    }
  | {
      type: 'mul';
      left: GeometryValue;
      right: GeometryValue;
    }
  | {
      type: 'div';
      left: GeometryValue;
      right: GeometryValue;
    }
  | {
      type: 'min';
      values: GeometryValue[];
    }
  | {
      type: 'max';
      values: GeometryValue[];
    }
  | {
      type: 'pin';
      min: GeometryValue;
      value: GeometryValue;
      max: GeometryValue;
    }
  | {
      type: 'sin';
      radius: GeometryValue;
      angle: GeometryValue;
    }
  | {
      type: 'cos';
      radius: GeometryValue;
      angle: GeometryValue;
    }
  | {
      type: 'gt';
      left: GeometryValue;
      right: GeometryValue;
    }
  | {
      type: 'ifElse';
      condition: GeometryValue;
      whenTrue: GeometryValue;
      whenFalse: GeometryValue;
    }
  | {
      type: 'sqrt';
      value: GeometryValue;
    }
  | {
      type: 'mod';
      x: GeometryValue;
      y: GeometryValue;
      z: GeometryValue;
    }
  | {
      type: 'at2';
      x: GeometryValue;
      y: GeometryValue;
    };

export interface GeometryGuide {
  name: string;
  value: GeometryValue;
}

export interface GeometryPoint {
  x: number;
  y: number;
}

export interface GeometryPointSpec {
  x: GeometryValue;
  y: GeometryValue;
}

export interface GeometryContext {
  width: number;
  height: number;
  get(name: string): number;
  resolve(value: GeometryValue): number;
}

export type GeometryPathCommand =
  | {
      type: 'M' | 'L';
      x: GeometryValue;
      y: GeometryValue;
    }
  | {
      type: 'H';
      x: GeometryValue;
    }
  | {
      type: 'V';
      y: GeometryValue;
    }
  | {
      type: 'Q';
      x1: GeometryValue;
      y1: GeometryValue;
      x: GeometryValue;
      y: GeometryValue;
    }
  | {
      type: 'C';
      x1: GeometryValue;
      y1: GeometryValue;
      x2: GeometryValue;
      y2: GeometryValue;
      x: GeometryValue;
      y: GeometryValue;
    }
  | {
      type: 'A';
      rx: GeometryValue;
      ry: GeometryValue;
      rotation?: GeometryValue;
      largeArc?: boolean | GeometryValue;
      sweep?: boolean | GeometryValue;
      x: GeometryValue;
      y: GeometryValue;
    }
  | {
      type: 'OA';
      rx: GeometryValue;
      ry: GeometryValue;
      startAngle: GeometryValue;
      sweepAngle: GeometryValue;
    }
  | {
      type: 'Z';
    };

export function guide(name: string, value: GeometryValue): GeometryGuide {
  return {
    name,
    value
  };
}

export function add(...values: GeometryValue[]): GeometryExpression {
  return {
    type: 'add',
    values
  };
}

export function sub(left: GeometryValue, right: GeometryValue): GeometryExpression {
  return {
    type: 'sub',
    left,
    right
  };
}

export function mul(left: GeometryValue, right: GeometryValue): GeometryExpression {
  return {
    type: 'mul',
    left,
    right
  };
}

export function div(left: GeometryValue, right: GeometryValue): GeometryExpression {
  return {
    type: 'div',
    left,
    right
  };
}

export function minValue(...values: GeometryValue[]): GeometryExpression {
  return {
    type: 'min',
    values
  };
}

export function maxValue(...values: GeometryValue[]): GeometryExpression {
  return {
    type: 'max',
    values
  };
}

export function pin(min: GeometryValue, value: GeometryValue, max: GeometryValue): GeometryExpression {
  return {
    type: 'pin',
    min,
    value,
    max
  };
}

export function sin(radius: GeometryValue, angle: GeometryValue): GeometryExpression {
  return {
    type: 'sin',
    radius,
    angle
  };
}

export function cos(radius: GeometryValue, angle: GeometryValue): GeometryExpression {
  return {
    type: 'cos',
    radius,
    angle
  };
}

export function gt(left: GeometryValue, right: GeometryValue): GeometryExpression {
  return {
    type: 'gt',
    left,
    right
  };
}

export function ifElse(
  condition: GeometryValue,
  whenTrue: GeometryValue,
  whenFalse: GeometryValue
): GeometryExpression {
  return {
    type: 'ifElse',
    condition,
    whenTrue,
    whenFalse
  };
}

export function sqrtValue(value: GeometryValue): GeometryExpression {
  return {
    type: 'sqrt',
    value
  };
}

export function modValue(x: GeometryValue, y: GeometryValue, z: GeometryValue): GeometryExpression {
  return {
    type: 'mod',
    x,
    y,
    z
  };
}

export function at2(x: GeometryValue, y: GeometryValue): GeometryExpression {
  return {
    type: 'at2',
    x,
    y
  };
}

export function createGeometryContext(
  width: number,
  height: number,
  guides: GeometryGuide[] = []
): GeometryContext {
  const builtins: Record<string, number> = {
    l: 0,
    t: 0,
    r: width,
    b: height,
    w: width,
    h: height,
    hc: width / 2,
    vc: height / 2,
    wd2: width / 2,
    hd2: height / 2,
    cx: width / 2,
    cy: height / 2,
    ss: Math.min(width, height),
    ls: Math.max(width, height),
    cd4: 5400000,
    cd2: 10800000,
    '3cd4': 16200000
  };
  const definitions = new Map(guides.map((entry) => [entry.name, entry.value]));
  const cache = new Map<string, number>(Object.entries(builtins));
  const resolving = new Set<string>();

  const get = (name: string): number => {
    const cached = cache.get(name);
    if (cached != null) {
      return cached;
    }

    const definition = definitions.get(name);
    if (definition == null) {
      throw new Error(`Unknown geometry guide: ${name}`);
    }

    if (resolving.has(name)) {
      throw new Error(`Circular geometry guide reference: ${name}`);
    }

    resolving.add(name);
    const value = resolve(definition);
    resolving.delete(name);
    cache.set(name, value);
    return value;
  };

  const resolve = (value: GeometryValue): number => resolveGeometryValue(value, { width, height, get, resolve });

  return {
    width,
    height,
    get,
    resolve
  };
}

export function resolveGeometryValue(value: GeometryValue, context: GeometryContext): number {
  if (typeof value === 'number') {
    return normalizeFiniteNumber(value);
  }

  if (typeof value === 'string') {
    return normalizeFiniteNumber(context.get(value));
  }

  switch (value.type) {
    case 'add':
      return normalizeFiniteNumber(value.values.reduce<number>((sum, entry) => sum + context.resolve(entry), 0));
    case 'sub':
      return normalizeFiniteNumber(context.resolve(value.left) - context.resolve(value.right));
    case 'mul':
      return normalizeFiniteNumber(context.resolve(value.left) * context.resolve(value.right));
    case 'div': {
      const denominator = context.resolve(value.right);
      if (Math.abs(denominator) < 1e-9) {
        return 0;
      }
      return normalizeFiniteNumber(context.resolve(value.left) / denominator);
    }
    case 'min':
      return normalizeFiniteNumber(Math.min(...value.values.map((entry) => context.resolve(entry))));
    case 'max':
      return normalizeFiniteNumber(Math.max(...value.values.map((entry) => context.resolve(entry))));
    case 'pin': {
      const minBound = context.resolve(value.min);
      const maxBound = context.resolve(value.max);
      const target = context.resolve(value.value);
      return normalizeFiniteNumber(Math.min(Math.max(target, minBound), maxBound));
    }
    case 'sin': {
      const radius = context.resolve(value.radius);
      const angle = (context.resolve(value.angle) * Math.PI) / 180;
      return normalizeFiniteNumber(radius * Math.sin(angle));
    }
    case 'cos': {
      const radius = context.resolve(value.radius);
      const angle = (context.resolve(value.angle) * Math.PI) / 180;
      return normalizeFiniteNumber(radius * Math.cos(angle));
    }
    case 'gt':
      return context.resolve(value.left) > context.resolve(value.right) ? 1 : 0;
    case 'ifElse':
      return normalizeFiniteNumber(
        context.resolve(value.condition) >= 0.5 ? context.resolve(value.whenTrue) : context.resolve(value.whenFalse)
      );
    case 'sqrt':
      return normalizeFiniteNumber(Math.sqrt(Math.max(0, context.resolve(value.value))));
    case 'mod':
      return normalizeFiniteNumber(
        Math.sqrt(
          Math.max(
            0,
            Math.pow(context.resolve(value.x), 2) +
              Math.pow(context.resolve(value.y), 2) +
              Math.pow(context.resolve(value.z), 2)
          )
        )
      );
    case 'at2':
      return normalizeFiniteNumber((Math.atan2(context.resolve(value.y), context.resolve(value.x)) * 180 * 60000) / Math.PI);
    default:
      return 0;
  }
}

export function resolveGeometryPoint(point: GeometryPointSpec, context: GeometryContext): GeometryPoint {
  return {
    x: context.resolve(point.x),
    y: context.resolve(point.y)
  };
}

export function buildPath(commands: GeometryPathCommand[], context: GeometryContext): string {
  const output: string[] = [];
  let currentX = 0;
  let currentY = 0;
  let subpathStartX = 0;
  let subpathStartY = 0;

  for (const command of commands) {
    switch (command.type) {
      case 'M':
      case 'L': {
        currentX = context.resolve(command.x);
        currentY = context.resolve(command.y);
        if (command.type === 'M') {
          subpathStartX = currentX;
          subpathStartY = currentY;
        }
        output.push(`${command.type} ${formatGeometryNumber(currentX)} ${formatGeometryNumber(currentY)}`);
        break;
      }
      case 'H':
        currentX = context.resolve(command.x);
        output.push(`H ${formatGeometryNumber(currentX)}`);
        break;
      case 'V':
        currentY = context.resolve(command.y);
        output.push(`V ${formatGeometryNumber(currentY)}`);
        break;
      case 'Q':
        currentX = context.resolve(command.x);
        currentY = context.resolve(command.y);
        output.push(
          `Q ${formatGeometryNumber(context.resolve(command.x1))} ${formatGeometryNumber(context.resolve(command.y1))} ${formatGeometryNumber(currentX)} ${formatGeometryNumber(currentY)}`
        );
        break;
      case 'C':
        currentX = context.resolve(command.x);
        currentY = context.resolve(command.y);
        output.push(
          `C ${formatGeometryNumber(context.resolve(command.x1))} ${formatGeometryNumber(context.resolve(command.y1))}, ${formatGeometryNumber(context.resolve(command.x2))} ${formatGeometryNumber(context.resolve(command.y2))}, ${formatGeometryNumber(currentX)} ${formatGeometryNumber(currentY)}`
        );
        break;
      case 'A':
        currentX = context.resolve(command.x);
        currentY = context.resolve(command.y);
        output.push(
          `A ${formatGeometryNumber(context.resolve(command.rx))} ${formatGeometryNumber(context.resolve(command.ry))} ${formatGeometryNumber(context.resolve(command.rotation ?? 0))} ${normalizeArcFlag(command.largeArc, context)} ${normalizeArcFlag(command.sweep, context)} ${formatGeometryNumber(currentX)} ${formatGeometryNumber(currentY)}`
        );
        break;
      case 'OA': {
        const rx = context.resolve(command.rx);
        const ry = context.resolve(command.ry);
        const startAngle = context.resolve(command.startAngle);
        const sweepAngle = context.resolve(command.sweepAngle);
        const startRadians = ooxAngleToRadians(startAngle);
        const endRadians = ooxAngleToRadians(startAngle + sweepAngle);
        const centerX = currentX - Math.cos(startRadians) * rx;
        const centerY = currentY - Math.sin(startRadians) * ry;
        currentX = centerX + Math.cos(endRadians) * rx;
        currentY = centerY + Math.sin(endRadians) * ry;
        output.push(
          `A ${formatGeometryNumber(rx)} ${formatGeometryNumber(ry)} 0 ${Math.abs(sweepAngle) > 10800000 ? '1' : '0'} ${sweepAngle >= 0 ? '1' : '0'} ${formatGeometryNumber(currentX)} ${formatGeometryNumber(currentY)}`
        );
        break;
      }
      case 'Z':
        output.push('Z');
        currentX = subpathStartX;
        currentY = subpathStartY;
        break;
    }
  }

  return output.join(' ');
}

export function buildPoints(points: GeometryPointSpec[], context: GeometryContext): string {
  return points
    .map((point) => {
      const resolved = resolveGeometryPoint(point, context);
      return `${formatGeometryNumber(resolved.x)},${formatGeometryNumber(resolved.y)}`;
    })
    .join(' ');
}

export function formatGeometryNumber(value: number): string {
  const normalized = normalizeFiniteNumber(value);
  const rounded = Number(normalized.toFixed(3));
  return Object.is(rounded, -0) ? '0' : String(rounded);
}

function normalizeArcFlag(value: boolean | GeometryValue | undefined, context: GeometryContext): string {
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }

  if (value == null) {
    return '0';
  }

  return context.resolve(value) >= 0.5 ? '1' : '0';
}

function normalizeFiniteNumber(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Object.is(value, -0) ? 0 : value;
}

function ooxAngleToRadians(value: number): number {
  return ((value / 60000) * Math.PI) / 180;
}
