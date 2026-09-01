export type PythonDocumentation = {
  signature: string
  description: string
  parameters?: string
  returns?: string
}

export type PythonReceiverKind = 'list' | 'dict' | 'str' | 'set' | 'tuple' | 'file' | 'deque' | 'math' | 'random' | 'sys' | 'collections' | 'heapq' | 'bisect' | 'itertools' | 'turtle' | 'turtle_instance' | 'turtle_screen'

const doc = (signature: string, description: string, parameters?: string, returns?: string): PythonDocumentation => ({
  signature, description, parameters, returns,
})

export const TURTLE_RUNTIME_NOTICE = '当前判题环境暂不支持 Turtle 图形输出。'
const turtleDoc = (signature: string, description: string, parameters?: string, returns?: string) =>
  doc(signature, `${description} ${TURTLE_RUNTIME_NOTICE}`, parameters, returns)

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
  EOFError: doc('EOFError', '读取输入时意外到达末尾所产生的异常。'),
  Exception: doc('Exception', '大多数普通异常的基础类型，可用于捕获常规运行错误。'),
  FileNotFoundError: doc('FileNotFoundError', '尝试打开不存在的文件时产生的异常。'),
  filter: doc('filter(function, iterable)', '保留使判断函数返回真的元素。'),
  float: doc('float(x=0)', '将数字或字符串转换为浮点数。'),
  format: doc('format(value, format_spec="")', '按照格式说明把值转换为字符串。'),
  hex: doc('hex(x)', '把整数转换为带 0x 前缀的十六进制字符串。'),
  input: doc('input(prompt="")', '显示可选提示并读取一行标准输入，返回字符串。'),
  int: doc('int(x=0, base=10)', '将数字或字符串转换为整数。', 'base：字符串使用的进制。'),
  IndexError: doc('IndexError', '使用超出序列范围的下标时产生的异常。'),
  isinstance: doc('isinstance(object, classinfo)', '判断对象是否属于指定类型。'),
  KeyError: doc('KeyError', '访问字典中不存在的键时产生的异常。'),
  len: doc('len(object)', '返回字符串、列表等容器中的元素数量。'),
  list: doc('list(iterable=())', '创建列表，或将可迭代对象转换为列表。'),
  map: doc('map(function, iterable, ...)', '把函数依次应用到可迭代对象的每个元素。'),
  max: doc('max(iterable, *, key=None)', '返回可迭代对象中的最大元素。', 'key：可选的比较键函数。'),
  min: doc('min(iterable, *, key=None)', '返回可迭代对象中的最小元素。', 'key：可选的比较键函数。'),
  ord: doc('ord(c)', '返回单个字符的 Unicode 编码。'),
  oct: doc('oct(x)', '把整数转换为带 0o 前缀的八进制字符串。'),
  open: doc('open(file, mode="r", encoding=None)', '打开文件并返回文件对象，推荐配合 with 使用。', 'file：文件路径；mode：打开模式；encoding：文本编码。', '文件对象。'),
  pow: doc('pow(base, exp, mod=None)', '计算 base 的 exp 次幂；指定 mod 时同时取模。'),
  print: doc('print(*objects, sep=" ", end="\\n")', '把一个或多个对象输出到标准输出。', 'sep：对象间分隔符；end：输出末尾字符。'),
  range: doc('range(start, stop, step=1)', '生成整数序列，常用于 for 循环。', 'stop 不包含在结果中；step 不能为 0。'),
  reversed: doc('reversed(sequence)', '返回按相反顺序访问序列的迭代器。'),
  round: doc('round(number, ndigits=None)', '将数字舍入到指定的小数位数。'),
  set: doc('set(iterable=())', '创建不包含重复元素的集合。'),
  sorted: doc('sorted(iterable, *, key=None, reverse=False)', '返回排序后的新列表，不修改原对象。', 'key：排序键函数；reverse：是否降序。'),
  str: doc('str(object="")', '将对象转换为字符串。'),
  sum: doc('sum(iterable, start=0)', '从 start 开始累加可迭代对象中的数值。'),
  super: doc('super()', '返回用于调用父类方法的代理对象。'),
  tuple: doc('tuple(iterable=())', '创建元组，或将可迭代对象转换为元组。'),
  type: doc('type(object)', '返回对象的类型。'),
  TypeError: doc('TypeError', '操作或函数收到不适用类型的对象时产生的异常。'),
  ValueError: doc('ValueError', '参数类型正确但值不符合要求时产生的异常。'),
  zip: doc('zip(*iterables, strict=False)', '把多个可迭代对象相同位置的元素组合成元组。'),
  ZeroDivisionError: doc('ZeroDivisionError', '进行除以零或模零运算时产生的异常。'),
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
  turtle_import: turtleDoc('import turtle', '导入 Turtle 绘图库。'),
  turtle_polygon: turtleDoc('for _ in range(sides): ...', '插入使用循环绘制正多边形的代码。', 'sides：边数；length：边长。'),
  turtle_loop: turtleDoc('for _ in range(count): ...', '插入重复前进和转向的循环绘图代码。'),
  turtle_fill: turtleDoc('begin_fill(); ...; end_fill()', '插入设置填充色并绘制填充图形的代码。'),
  turtle_pen: turtleDoc('pen = turtle.Turtle()', '创建一个可独立控制的画笔对象。'),
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
  file: {
    read: doc('file.read(size=-1)', '读取文件内容；默认读取到文件末尾。', 'size：最多读取的字符数或字节数，-1 表示全部。', '读取到的字符串或字节串。'),
    readline: doc('file.readline(size=-1)', '从文件中读取一行，结果通常包含行末换行符。'),
    readlines: doc('file.readlines()', '读取文件中的所有行并返回列表。'),
    write: doc('file.write(data)', '把字符串或字节数据写入文件。', 'data：要写入的内容。', '实际写入的字符数或字节数。'),
    writelines: doc('file.writelines(lines)', '依次写入多段内容，不会自动添加换行符。'),
    close: doc('file.close()', '关闭文件并释放相关系统资源。'),
    seek: doc('file.seek(offset, whence=0)', '移动文件的当前读写位置。'),
    tell: doc('file.tell()', '返回文件当前的读写位置。'),
    flush: doc('file.flush()', '立即把缓冲区中的待写内容刷新到文件。'),
  },
  deque: {
    append: doc('deque.append(value)', '在双端队列右端添加一个元素。'),
    appendleft: doc('deque.appendleft(value)', '在双端队列左端添加一个元素。'),
    clear: doc('deque.clear()', '删除双端队列中的所有元素。'),
    extend: doc('deque.extend(iterable)', '在双端队列右端依次添加多个元素。'),
    extendleft: doc('deque.extendleft(iterable)', '在双端队列左端依次添加多个元素，加入后的顺序与输入相反。'),
    pop: doc('deque.pop()', '删除并返回双端队列最右端的元素。'),
    popleft: doc('deque.popleft()', '删除并返回双端队列最左端的元素。'),
    rotate: doc('deque.rotate(n=1)', '循环移动双端队列；正数向右移动，负数向左移动。'),
  },
  math: {
    ceil: doc('math.ceil(x)', '返回大于或等于 x 的最小整数。'), floor: doc('math.floor(x)', '返回小于或等于 x 的最大整数。'),
    factorial: doc('math.factorial(n)', '返回非负整数 n 的阶乘。'), gcd: doc('math.gcd(*integers)', '返回多个整数的最大公约数。'),
    isqrt: doc('math.isqrt(n)', '返回非负整数平方根的向下取整结果。'), lcm: doc('math.lcm(*integers)', '返回多个整数的最小公倍数。'),
    log: doc('math.log(x, base=...)', '计算对数；未指定 base 时计算自然对数。'), log2: doc('math.log2(x)', '返回以 2 为底的对数。'),
    log10: doc('math.log10(x)', '返回以 10 为底的对数。'), exp: doc('math.exp(x)', '返回 e 的 x 次幂。'),
    sin: doc('math.sin(x)', '返回弧度 x 的正弦值。'), cos: doc('math.cos(x)', '返回弧度 x 的余弦值。'), tan: doc('math.tan(x)', '返回弧度 x 的正切值。'),
    asin: doc('math.asin(x)', '返回 x 的反正弦值，结果单位为弧度。'), acos: doc('math.acos(x)', '返回 x 的反余弦值，结果单位为弧度。'),
    atan: doc('math.atan(x)', '返回 x 的反正切值，结果单位为弧度。'), radians: doc('math.radians(degrees)', '把角度转换为弧度。'),
    degrees: doc('math.degrees(radians)', '把弧度转换为角度。'), pi: doc('math.pi', '圆周率 π 的浮点近似值。'), e: doc('math.e', '自然对数底数 e 的浮点近似值。'),
    comb: doc('math.comb(n, k)', '返回从 n 个元素中选择 k 个元素的组合数。'), perm: doc('math.perm(n, k=None)', '返回从 n 个元素中选取并排列 k 个元素的排列数。'),
    pow: doc('math.pow(x, y)', '以浮点数形式计算 x 的 y 次幂。'), sqrt: doc('math.sqrt(x)', '返回 x 的平方根。'),
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
    argv: doc('sys.argv', '保存命令行参数的字符串列表。'), stdin: doc('sys.stdin', '标准输入流，可调用 readline() 快速读取输入。'),
    stdout: doc('sys.stdout', '标准输出流，可调用 write() 输出内容。'),
  },
  collections: {
    Counter: doc('collections.Counter(iterable=None)', '创建用于统计元素出现次数的字典子类。'),
    defaultdict: doc('collections.defaultdict(default_factory=None)', '创建可为缺失键自动生成默认值的字典子类。'),
    deque: doc('collections.deque(iterable=(), maxlen=None)', '创建支持两端高效添加和删除的双端队列。'),
  },
  heapq: {
    heapify: doc('heapq.heapify(list)', '原地把列表转换为最小堆。'), heappop: doc('heapq.heappop(heap)', '弹出并返回堆中的最小元素。'),
    heappush: doc('heapq.heappush(heap, item)', '向堆中加入元素。'), heappushpop: doc('heapq.heappushpop(heap, item)', '先加入元素，再弹出并返回最小元素。'),
    heapreplace: doc('heapq.heapreplace(heap, item)', '先弹出最小元素，再把新元素加入堆。'),
    merge: doc('heapq.merge(*iterables)', '合并多个已经有序的可迭代对象。'), nlargest: doc('heapq.nlargest(n, iterable, key=None)', '返回最大的 n 个元素。'),
    nsmallest: doc('heapq.nsmallest(n, iterable, key=None)', '返回最小的 n 个元素。'),
  },
  bisect: {
    bisect_left: doc('bisect.bisect_left(sequence, value)', '返回在有序序列中插入 value 的最左位置。'),
    bisect_right: doc('bisect.bisect_right(sequence, value)', '返回在有序序列中插入 value 的最右位置。'),
    insort_left: doc('bisect.insort_left(sequence, value)', '把 value 插入有序列表的最左适当位置。'),
    insort_right: doc('bisect.insort_right(sequence, value)', '把 value 插入有序列表的最右适当位置。'),
  },
  itertools: {
    combinations: doc('itertools.combinations(iterable, r)', '生成从元素中选择 r 个且不考虑顺序的组合。'),
    permutations: doc('itertools.permutations(iterable, r=None)', '生成元素的排列。'),
    product: doc('itertools.product(*iterables, repeat=1)', '生成多个可迭代对象的笛卡尔积。'),
  },
  turtle: {
    forward: turtleDoc('turtle.forward(distance)', '沿当前方向前进指定距离。', 'distance：前进距离，可为负数。'),
    fd: turtleDoc('turtle.fd(distance)', 'forward() 的简写，沿当前方向前进。', 'distance：前进距离。'),
    backward: turtleDoc('turtle.backward(distance)', '沿当前方向后退指定距离。', 'distance：后退距离。'),
    back: turtleDoc('turtle.back(distance)', 'backward() 的简写，沿当前方向后退。'),
    bk: turtleDoc('turtle.bk(distance)', 'backward() 的简写，沿当前方向后退。'),
    right: turtleDoc('turtle.right(angle)', '向右旋转指定角度。', 'angle：旋转角度。'),
    rt: turtleDoc('turtle.rt(angle)', 'right() 的简写，向右旋转。'),
    left: turtleDoc('turtle.left(angle)', '向左旋转指定角度。', 'angle：旋转角度。'),
    lt: turtleDoc('turtle.lt(angle)', 'left() 的简写，向左旋转。'),
    goto: turtleDoc('turtle.goto(x, y)', '移动到指定坐标；落笔时会画线。', 'x、y：目标坐标。'),
    setpos: turtleDoc('turtle.setpos(x, y)', 'goto() 的别名，移动到指定坐标。'),
    setposition: turtleDoc('turtle.setposition(x, y)', 'goto() 的别名，移动到指定坐标。'),
    setx: turtleDoc('turtle.setx(x)', '只修改横坐标。'), sety: turtleDoc('turtle.sety(y)', '只修改纵坐标。'),
    setheading: turtleDoc('turtle.setheading(angle)', '设置画笔朝向角度。'), seth: turtleDoc('turtle.seth(angle)', 'setheading() 的简写。'),
    home: turtleDoc('turtle.home()', '回到原点并恢复初始朝向。'),
    circle: turtleDoc('turtle.circle(radius, extent=None, steps=None)', '绘制圆、圆弧或近似正多边形。', 'radius：半径；extent：圆弧角度；steps：用多少条线段近似。'),
    dot: turtleDoc('turtle.dot(size=None, color=None)', '在当前位置绘制圆点。'),
    stamp: turtleDoc('turtle.stamp()', '在当前位置印下画笔形状。', undefined, '印章编号。'),
    clearstamp: turtleDoc('turtle.clearstamp(stampid)', '删除指定印章。'), clearstamps: turtleDoc('turtle.clearstamps(n=None)', '删除全部或指定数量的印章。'),
    undo: turtleDoc('turtle.undo()', '撤销最近一次画笔操作。'), speed: turtleDoc('turtle.speed(speed=None)', '设置或读取绘制速度，0 表示最快。', 'speed：0–10 的整数或速度名称。'),
    position: turtleDoc('turtle.position()', '返回当前坐标。', undefined, '二维坐标。'), pos: turtleDoc('turtle.pos()', 'position() 的简写。'),
    xcor: turtleDoc('turtle.xcor()', '返回当前横坐标。'), ycor: turtleDoc('turtle.ycor()', '返回当前纵坐标。'),
    heading: turtleDoc('turtle.heading()', '返回当前朝向角度。'), distance: turtleDoc('turtle.distance(x, y)', '返回当前位置到目标点的距离。'),
    towards: turtleDoc('turtle.towards(x, y)', '返回从当前位置指向目标点的角度。'),
    degrees: turtleDoc('turtle.degrees(fullcircle=360.0)', '将角度单位设置为度。'), radians: turtleDoc('turtle.radians()', '将角度单位设置为弧度。'),
    pendown: turtleDoc('turtle.pendown()', '落下画笔，之后移动会画线。'), pd: turtleDoc('turtle.pd()', 'pendown() 的简写。'), down: turtleDoc('turtle.down()', 'pendown() 的别名。'),
    penup: turtleDoc('turtle.penup()', '抬起画笔，之后移动不画线。'), pu: turtleDoc('turtle.pu()', 'penup() 的简写。'), up: turtleDoc('turtle.up()', 'penup() 的别名。'),
    pensize: turtleDoc('turtle.pensize(width=None)', '设置或读取画笔线宽。'), width: turtleDoc('turtle.width(width=None)', 'pensize() 的别名。'),
    pen: turtleDoc('turtle.pen(pen=None, **pendict)', '读取或批量设置画笔属性。'), isdown: turtleDoc('turtle.isdown()', '判断画笔当前是否落下。', undefined, '布尔值。'),
    pencolor: turtleDoc('turtle.pencolor(*args)', '设置或读取画笔颜色。'), fillcolor: turtleDoc('turtle.fillcolor(*args)', '设置或读取填充颜色。'),
    color: turtleDoc('turtle.color(*args)', '同时设置或读取画笔颜色与填充颜色。'),
    begin_fill: turtleDoc('turtle.begin_fill()', '开始记录需要填充的图形边界。'), end_fill: turtleDoc('turtle.end_fill()', '结束边界记录并填充图形。'),
    filling: turtleDoc('turtle.filling()', '判断当前是否正在记录填充边界。'),
    reset: turtleDoc('turtle.reset()', '清除当前画笔绘图并恢复初始状态。'), clear: turtleDoc('turtle.clear()', '清除当前画笔绘制的内容但保留状态。'),
    write: turtleDoc('turtle.write(arg, move=False, align="left", font=("Arial", 8, "normal"))', '在当前位置书写文字。'),
    hideturtle: turtleDoc('turtle.hideturtle()', '隐藏画笔图形。'), ht: turtleDoc('turtle.ht()', 'hideturtle() 的简写。'),
    showturtle: turtleDoc('turtle.showturtle()', '显示画笔图形。'), st: turtleDoc('turtle.st()', 'showturtle() 的简写。'),
    isvisible: turtleDoc('turtle.isvisible()', '判断画笔图形是否可见。'), shape: turtleDoc('turtle.shape(name=None)', '设置或读取画笔形状。'),
    shapesize: turtleDoc('turtle.shapesize(stretch_wid=None, stretch_len=None, outline=None)', '设置或读取画笔形状缩放。'), turtlesize: turtleDoc('turtle.turtlesize(...)', 'shapesize() 的别名。'),
    tilt: turtleDoc('turtle.tilt(angle)', '旋转画笔形状。'), settiltangle: turtleDoc('turtle.settiltangle(angle)', '设置画笔形状的倾斜角。'),
    onclick: turtleDoc('turtle.onclick(fun, btn=1, add=None)', '绑定点击画笔时执行的函数。'), onrelease: turtleDoc('turtle.onrelease(fun, btn=1, add=None)', '绑定释放鼠标按钮时执行的函数。'),
    ondrag: turtleDoc('turtle.ondrag(fun, btn=1, add=None)', '绑定拖动画笔时执行的函数。'),
    Turtle: turtleDoc('turtle.Turtle(shape="classic", undobuffersize=1000, visible=True)', '创建一个可独立控制的画笔对象。', undefined, 'Turtle 画笔对象。'),
    Screen: turtleDoc('turtle.Screen()', '取得或创建绘图窗口。', undefined, 'TurtleScreen 窗口对象。'),
    done: turtleDoc('turtle.done()', '进入事件循环，通常放在绘图程序末尾。'), mainloop: turtleDoc('turtle.mainloop()', 'done() 的别名，进入事件循环。'),
  },
  turtle_instance: {},
  turtle_screen: {
    bgcolor: turtleDoc('screen.bgcolor(*args)', '设置或读取窗口背景颜色。'), bgpic: turtleDoc('screen.bgpic(picname=None)', '设置或读取窗口背景图片。'),
    screensize: turtleDoc('screen.screensize(canvwidth=None, canvheight=None, bg=None)', '设置或读取画布大小。'), setup: turtleDoc('screen.setup(width=0.5, height=0.75, startx=None, starty=None)', '设置窗口大小和位置。'),
    title: turtleDoc('screen.title(titlestring)', '设置绘图窗口标题。'), colormode: turtleDoc('screen.colormode(cmode=None)', '设置颜色分量使用 1.0 或 255 模式。'),
    tracer: turtleDoc('screen.tracer(n=None, delay=None)', '控制屏幕刷新频率，可用于加速动画。'), update: turtleDoc('screen.update()', '立即刷新绘图窗口。'),
    delay: turtleDoc('screen.delay(delay=None)', '设置或读取绘图延迟毫秒数。'),
    listen: turtleDoc('screen.listen(xdummy=None, ydummy=None)', '让窗口开始接收键盘事件。'),
    onkey: turtleDoc('screen.onkey(fun, key)', '绑定松开按键时执行的函数。'), onkeypress: turtleDoc('screen.onkeypress(fun, key=None)', '绑定按下按键时执行的函数。'), onkeyrelease: turtleDoc('screen.onkeyrelease(fun, key)', '绑定松开按键时执行的函数。'),
    onclick: turtleDoc('screen.onclick(fun, btn=1, add=None)', '绑定点击画布时执行的函数。'), onscreenclick: turtleDoc('screen.onscreenclick(fun, btn=1, add=None)', 'onclick() 的别名。'),
    ontimer: turtleDoc('screen.ontimer(fun, t=0)', '在指定毫秒后调用函数。'),
    bye: turtleDoc('screen.bye()', '关闭绘图窗口。'), exitonclick: turtleDoc('screen.exitonclick()', '点击窗口后关闭。'), mainloop: turtleDoc('screen.mainloop()', '进入事件循环。'),
    reset: turtleDoc('screen.reset()', '重置窗口中的所有画笔。'), clear: turtleDoc('screen.clear()', '清空窗口中的所有绘图和绑定。'),
    turtles: turtleDoc('screen.turtles()', '返回窗口中的画笔列表。'), window_width: turtleDoc('screen.window_width()', '返回窗口宽度。'), window_height: turtleDoc('screen.window_height()', '返回窗口高度。'),
    register_shape: turtleDoc('screen.register_shape(name, shape=None)', '注册可供画笔使用的新形状。'), addshape: turtleDoc('screen.addshape(name, shape=None)', 'register_shape() 的别名。'), getshapes: turtleDoc('screen.getshapes()', '返回已注册的形状名称。'),
  },
}

memberDocumentation.turtle_instance = Object.fromEntries(
  Object.entries(memberDocumentation.turtle).filter(([label]) => !['Turtle', 'Screen', 'done', 'mainloop'].includes(label)),
)

export const builtinLabels = Object.keys(builtinDocumentation)
export const keywordLabels = Object.keys(keywordDescriptions)

export function pythonMemberDocumentationEntries(receiverKind: PythonReceiverKind): [string, PythonDocumentation][] {
  return Object.entries(memberDocumentation[receiverKind] ?? {})
}

export function pythonDocumentationFor(label: string, receiverKind?: PythonReceiverKind, detail = ''): PythonDocumentation | undefined {
  if (!receiverKind) return builtinDocumentation[label]
  const direct = memberDocumentation[receiverKind]?.[label]
  if (direct) return direct
  if (/\bdeque\b/i.test(detail) && memberDocumentation.deque[label]) return memberDocumentation.deque[label]
  if (/(?:TextIO|BinaryIO|TextIOWrapper|BufferedReader|BufferedWriter|_io\.)/i.test(detail) && memberDocumentation.file[label]) return memberDocumentation.file[label]
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
  if (/\bdeque\b/i.test(detail) && memberDocumentation.deque[label]) return memberDocumentation.deque[label]
  if (/(?:TextIO|BinaryIO|TextIOWrapper|BufferedReader|BufferedWriter|_io\.)/i.test(detail) && memberDocumentation.file[label]) return memberDocumentation.file[label]
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
