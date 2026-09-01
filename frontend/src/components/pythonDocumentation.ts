export type PythonDocumentation = {
  signature: string
  description: string
  parameters?: string
  returns?: string
}

export type PythonReceiverKind = 'list' | 'dict' | 'str' | 'set' | 'tuple' | 'math' | 'random' | 'sys' | 'collections' | 'heapq'

const doc = (signature: string, description: string, parameters?: string, returns?: string): PythonDocumentation => ({
  signature, description, parameters, returns,
})

export const builtinDocumentation: Record<string, PythonDocumentation> = {
  abs: doc('abs(x)', '返回数字的绝对值。', 'x：整数、浮点数或实现了绝对值运算的对象。', '绝对值。'),
  all: doc('all(iterable)', '所有元素都为真时返回 True；空对象也返回 True。'),
  any: doc('any(iterable)', '至少一个元素为真时返回 True。'),
  bin: doc('bin(x)', '把整数转换为带 0b 前缀的二进制字符串。'),
  bool: doc('bool(object=False)', '将对象转换为布尔值 True 或 False。'),
  chr: doc('chr(i)', '返回 Unicode 编码为 i 的字符。'),
  dict: doc('dict(...)', '创建字典，可接收键值对序列或关键字参数。'),
  divmod: doc('divmod(a, b)', '同时计算整除结果和余数。', 'a、b：参与运算的数字。', '(a // b, a % b)。'),
  enumerate: doc('enumerate(iterable, start=0)', '遍历元素时同时生成序号。', 'iterable：被遍历对象；start：起始序号。'),
  filter: doc('filter(function, iterable)', '保留使判断函数返回真的元素。'),
  float: doc('float(x=0)', '将数字或字符串转换为浮点数。'),
  format: doc('format(value, format_spec="")', '按照格式说明把值转换为字符串。'),
  input: doc('input(prompt="")', '显示可选提示并读取一行标准输入，返回字符串。'),
  int: doc('int(x=0, base=10)', '将数字或字符串转换为整数。', 'base：字符串使用的进制。'),
  isinstance: doc('isinstance(object, classinfo)', '判断对象是否属于指定类型。'),
  len: doc('len(object)', '返回字符串、列表等容器中的元素数量。'),
  list: doc('list(iterable=())', '创建列表，或将可迭代对象转换为列表。'),
  map: doc('map(function, iterable, ...)', '把函数依次应用到可迭代对象的每个元素。'),
  max: doc('max(iterable, *, key=None)', '返回可迭代对象中的最大元素。', 'key：可选的比较键函数。'),
  min: doc('min(iterable, *, key=None)', '返回可迭代对象中的最小元素。', 'key：可选的比较键函数。'),
  ord: doc('ord(c)', '返回单个字符的 Unicode 编码。'),
  pow: doc('pow(base, exp, mod=None)', '计算 base 的 exp 次幂；指定 mod 时同时取模。'),
  print: doc('print(*objects, sep=" ", end="\\n")', '把一个或多个对象输出到标准输出。', 'sep：对象间分隔符；end：输出末尾字符。'),
  range: doc('range(start, stop, step=1)', '生成整数序列，常用于 for 循环。', 'stop 不包含在结果中；step 不能为 0。'),
  reversed: doc('reversed(sequence)', '返回按相反顺序访问序列的迭代器。'),
  round: doc('round(number, ndigits=None)', '将数字舍入到指定的小数位数。'),
  set: doc('set(iterable=())', '创建不包含重复元素的集合。'),
  sorted: doc('sorted(iterable, *, key=None, reverse=False)', '返回排序后的新列表，不修改原对象。', 'key：排序键函数；reverse：是否降序。'),
  str: doc('str(object="")', '将对象转换为字符串。'),
  sum: doc('sum(iterable, start=0)', '从 start 开始累加可迭代对象中的数值。'),
  tuple: doc('tuple(iterable=())', '创建元组，或将可迭代对象转换为元组。'),
  type: doc('type(object)', '返回对象的类型。'),
  zip: doc('zip(*iterables, strict=False)', '把多个可迭代对象相同位置的元素组合成元组。'),
}

export const keywordDescriptions: Record<string, string> = {
  and: '逻辑与运算。', as: '为导入对象或异常指定别名。', assert: '断言条件为真，否则抛出异常。', async: '声明异步函数或上下文。', await: '等待异步操作完成。',
  break: '立即结束当前循环。', class: '定义类。', continue: '跳过本轮循环的剩余语句。', del: '删除名称、属性或容器元素。', elif: '为 if 增加条件分支。', else: '定义条件不满足时的分支。', except: '捕获并处理异常。',
  False: '布尔假值。', finally: '定义无论是否异常都会执行的代码。', from: '从模块中导入指定名称。', global: '声明名称来自全局作用域。', if: '根据条件执行分支。', import: '导入模块或名称。', in: '检查成员关系或用于遍历。', is: '比较两个引用是否指向同一对象。',
  lambda: '创建匿名函数。', None: '表示没有值的单例对象。', nonlocal: '声明名称来自外层非全局作用域。', not: '逻辑非运算。', or: '逻辑或运算。', pass: '空语句，占位但不执行操作。', raise: '主动抛出异常。', return: '结束函数并返回结果。', True: '布尔真值。', try: '开始异常处理代码块。', while: '条件为真时重复执行。', with: '使用上下文管理器安全管理资源。', yield: '从生成器产出一个值并暂停执行。',
}

export const snippetDocumentation: Record<string, PythonDocumentation> = {
  if: doc('if condition:', '插入条件判断代码块。'),
  for: doc('for item in range(count):', '插入按次数遍历的 for 循环。'),
  while: doc('while condition:', '插入条件循环代码块。'),
  def: doc('def name(arguments):', '插入函数定义代码块。'),
}

const memberDocumentation: Record<PythonReceiverKind, Record<string, PythonDocumentation>> = {
  list: {
    append: doc('list.append(object)', '在列表末尾添加一个元素。'), clear: doc('list.clear()', '删除列表中的所有元素。'),
    copy: doc('list.copy()', '返回列表的浅拷贝。'), count: doc('list.count(value)', '统计指定值在列表中出现的次数。'),
    extend: doc('list.extend(iterable)', '把可迭代对象中的所有元素追加到列表末尾。'), index: doc('list.index(value, start=0, stop=...)', '返回指定值首次出现的位置；找不到时抛出异常。'),
    insert: doc('list.insert(index, object)', '在指定位置插入元素。'), pop: doc('list.pop(index=-1)', '删除并返回指定位置的元素，默认处理最后一个元素。'),
    remove: doc('list.remove(value)', '删除列表中第一个等于指定值的元素。'), reverse: doc('list.reverse()', '原地反转列表。'),
    sort: doc('list.sort(*, key=None, reverse=False)', '原地排序列表，不返回新列表。'),
  },
  dict: {
    clear: doc('dict.clear()', '删除字典中的所有键值对。'), copy: doc('dict.copy()', '返回字典的浅拷贝。'),
    fromkeys: doc('dict.fromkeys(iterable, value=None)', '使用一组键和相同默认值创建新字典。'), get: doc('dict.get(key, default=None)', '读取键对应的值；键不存在时返回默认值，不抛出异常。'),
    items: doc('dict.items()', '返回可遍历的键值对视图。'), keys: doc('dict.keys()', '返回可遍历的键视图。'),
    pop: doc('dict.pop(key, default=...)', '删除指定键并返回它的值。'), popitem: doc('dict.popitem()', '删除并返回最后加入的一对键和值。'),
    setdefault: doc('dict.setdefault(key, default=None)', '读取键对应的值；键不存在时先写入默认值。'), update: doc('dict.update(other)', '用其他键值对更新字典。'),
    values: doc('dict.values()', '返回可遍历的值视图。'),
  },
  str: {
    capitalize: doc('str.capitalize()', '返回首字符大写、其余字符小写的新字符串。'), count: doc('str.count(sub, start=0, end=...)', '统计子串出现的次数。'),
    endswith: doc('str.endswith(suffix)', '判断字符串是否以指定后缀结束。'), find: doc('str.find(sub)', '返回子串首次出现的位置，找不到时返回 -1。'),
    format: doc('str.format(*args, **kwargs)', '使用参数替换字符串中的格式占位符。'), index: doc('str.index(sub)', '返回子串首次出现的位置，找不到时抛出异常。'),
    isalnum: doc('str.isalnum()', '判断字符串是否只包含字母或数字且非空。'), isalpha: doc('str.isalpha()', '判断字符串是否只包含字母且非空。'),
    isdigit: doc('str.isdigit()', '判断字符串是否只包含数字且非空。'), islower: doc('str.islower()', '判断字符串中的字母是否都是小写。'),
    isspace: doc('str.isspace()', '判断字符串是否只包含空白字符且非空。'), isupper: doc('str.isupper()', '判断字符串中的字母是否都是大写。'),
    join: doc('separator.join(iterable)', '使用当前字符串连接可迭代对象中的字符串。'), lower: doc('str.lower()', '返回全部字母转换为小写的新字符串。'),
    lstrip: doc('str.lstrip(chars=None)', '删除字符串左侧指定字符，默认删除空白。'), replace: doc('str.replace(old, new, count=-1)', '返回替换指定子串后的新字符串。'),
    rfind: doc('str.rfind(sub)', '从右侧查找子串，找不到时返回 -1。'), rstrip: doc('str.rstrip(chars=None)', '删除字符串右侧指定字符，默认删除空白。'),
    split: doc('str.split(sep=None, maxsplit=-1)', '按照分隔符拆分字符串并返回列表。'), splitlines: doc('str.splitlines()', '按照换行边界拆分字符串并返回列表。'),
    startswith: doc('str.startswith(prefix)', '判断字符串是否以指定前缀开始。'), strip: doc('str.strip(chars=None)', '删除字符串两侧指定字符，默认删除空白。'),
    title: doc('str.title()', '返回每个单词首字母大写的新字符串。'), upper: doc('str.upper()', '返回全部字母转换为大写的新字符串。'),
    zfill: doc('str.zfill(width)', '在字符串左侧补零到指定宽度。'),
  },
  set: {
    add: doc('set.add(element)', '向集合加入一个元素。'), clear: doc('set.clear()', '删除集合中的所有元素。'), copy: doc('set.copy()', '返回集合的浅拷贝。'),
    difference: doc('set.difference(*others)', '返回只属于当前集合、不属于其他集合的元素。'), discard: doc('set.discard(element)', '删除元素；元素不存在时不报错。'),
    intersection: doc('set.intersection(*others)', '返回多个集合的交集。'), isdisjoint: doc('set.isdisjoint(other)', '判断两个集合是否没有共同元素。'),
    issubset: doc('set.issubset(other)', '判断当前集合是否是另一个集合的子集。'), issuperset: doc('set.issuperset(other)', '判断当前集合是否是另一个集合的超集。'),
    pop: doc('set.pop()', '删除并返回集合中的任意一个元素。'), remove: doc('set.remove(element)', '删除元素；元素不存在时抛出异常。'),
    symmetric_difference: doc('set.symmetric_difference(other)', '返回只属于其中一个集合的元素。'), union: doc('set.union(*others)', '返回多个集合的并集。'),
    update: doc('set.update(*others)', '把其他集合或可迭代对象中的元素加入当前集合。'),
  },
  tuple: {
    count: doc('tuple.count(value)', '统计指定值在元组中出现的次数。'), index: doc('tuple.index(value, start=0, stop=...)', '返回指定值首次出现的位置。'),
  },
  math: {
    ceil: doc('math.ceil(x)', '返回大于或等于 x 的最小整数。'), floor: doc('math.floor(x)', '返回小于或等于 x 的最大整数。'),
    factorial: doc('math.factorial(n)', '返回非负整数 n 的阶乘。'), gcd: doc('math.gcd(*integers)', '返回多个整数的最大公约数。'),
    isqrt: doc('math.isqrt(n)', '返回非负整数平方根的向下取整结果。'), lcm: doc('math.lcm(*integers)', '返回多个整数的最小公倍数。'),
    log: doc('math.log(x, base=...)', '计算对数；未指定 base 时计算自然对数。'), pow: doc('math.pow(x, y)', '以浮点数形式计算 x 的 y 次幂。'),
    sqrt: doc('math.sqrt(x)', '返回 x 的平方根。'),
  },
  random: {
    choice: doc('random.choice(sequence)', '从非空序列中随机选择一个元素。'), randint: doc('random.randint(a, b)', '返回闭区间 [a, b] 内的随机整数。'),
    random: doc('random.random()', '返回 [0.0, 1.0) 范围内的随机浮点数。'), randrange: doc('random.randrange(start, stop, step=1)', '从指定整数范围中随机选择一个值。'),
    sample: doc('random.sample(population, k)', '从总体中随机选择 k 个不重复元素。'), seed: doc('random.seed(a=None)', '初始化随机数生成器；固定种子可复现实验结果。'),
    shuffle: doc('random.shuffle(list)', '原地随机打乱列表。'),
  },
  sys: {
    exit: doc('sys.exit(status=None)', '请求结束当前 Python 程序。'), getsizeof: doc('sys.getsizeof(object)', '返回对象占用的近似字节数。'),
    setrecursionlimit: doc('sys.setrecursionlimit(limit)', '设置 Python 解释器允许的最大递归深度。'),
  },
  collections: {
    Counter: doc('collections.Counter(iterable=None)', '创建用于统计元素出现次数的字典子类。'),
    defaultdict: doc('collections.defaultdict(default_factory=None)', '创建可为缺失键自动生成默认值的字典子类。'),
    deque: doc('collections.deque(iterable=(), maxlen=None)', '创建支持两端高效添加和删除的双端队列。'),
  },
  heapq: {
    heapify: doc('heapq.heapify(list)', '原地把列表转换为最小堆。'), heappop: doc('heapq.heappop(heap)', '弹出并返回堆中的最小元素。'),
    heappush: doc('heapq.heappush(heap, item)', '向堆中加入元素。'), heappushpop: doc('heapq.heappushpop(heap, item)', '先加入元素，再弹出并返回最小元素。'),
    nlargest: doc('heapq.nlargest(n, iterable, key=None)', '返回最大的 n 个元素。'), nsmallest: doc('heapq.nsmallest(n, iterable, key=None)', '返回最小的 n 个元素。'),
  },
}

export const builtinLabels = Object.keys(builtinDocumentation)
export const keywordLabels = Object.keys(keywordDescriptions)

export function pythonDocumentationFor(label: string, receiverKind?: PythonReceiverKind, detail = ''): PythonDocumentation | undefined {
  if (!receiverKind) return builtinDocumentation[label]
  const direct = memberDocumentation[receiverKind]?.[label]
  if (direct) return direct
  const candidates = (Object.keys(memberDocumentation) as PythonReceiverKind[])
    .map((kind) => ({ kind, value: memberDocumentation[kind][label] }))
    .filter((item): item is { kind: PythonReceiverKind; value: PythonDocumentation } => Boolean(item.value))
  if (candidates.length === 1) return candidates[0].value
  if (label === 'pop') {
    if (/SupportsIndex|index\s*[:=]/i.test(detail)) return memberDocumentation.list.pop
    if (/key\s*[:=]/i.test(detail)) return memberDocumentation.dict.pop
    if (/pop\(\)/i.test(detail)) return memberDocumentation.set.pop
  }
  const descriptions = new Set(candidates.map((item) => item.value.description))
  return descriptions.size === 1 ? candidates[0]?.value : undefined
}

export function pythonMemberDocumentationFor(label: string, receiverKind?: PythonReceiverKind, detail = ''): PythonDocumentation | undefined {
  if (receiverKind) return pythonDocumentationFor(label, receiverKind, detail)
  const candidates = (Object.keys(memberDocumentation) as PythonReceiverKind[])
    .map((kind) => ({ kind, value: memberDocumentation[kind][label] }))
    .filter((item): item is { kind: PythonReceiverKind; value: PythonDocumentation } => Boolean(item.value))
  if (candidates.length === 1) return candidates[0].value
  if (label === 'pop') {
    if (/SupportsIndex|index\s*[:=]/i.test(detail)) return memberDocumentation.list.pop
    if (/key\s*[:=]/i.test(detail)) return memberDocumentation.dict.pop
    if (/pop\(\)/i.test(detail)) return memberDocumentation.set.pop
  }
  const descriptions = new Set(candidates.map((item) => item.value.description))
  return descriptions.size === 1 ? candidates[0]?.value : undefined
}
