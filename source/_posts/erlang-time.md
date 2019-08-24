---
title: Erlang时间系统
date: 2018-03-29
---

Erlang系统中有两套时间系统。一个是操作系统时间，一个是虚拟机时间。我们知道，操作系统时间是非常不可靠的，
它依靠ntp跟网络上服服务器同步，也有可能被人为修改。如果依赖操作系统时间，程序可能出现异常的行为。
比如游戏中一个设定是每天0点进行结算，如果结算完一次这时操作系统时间调整回去了，结果又会结算一次。
因此ERTS在操作系统时间的基础之上引入了虚拟机时间。

在Erlang/OTP 18(ERTS 7.0)之前，获取时间的接口主要是两个：

* erlang:now()返回虚拟机时间
* os:timestamp()返回操作系统时间。

erlang:now()存在性能问题，因此很多软件被迫使用os:timestamp()来代替。但是操作系统时间又存在时间回退的问题。

18之前，操作系统时间变化时，只能通过时间纠正来慢慢系统时间对齐，这个调整的过程可能是非常漫长的。
1分钟的差异需要100分钟才能调整完。这段时间内的时间间隔，定时器都会受到影响，大约存在1%的偏差。

从OTP 18以后，把虚拟机时间分为了两个部分，time_offset和monotonic_time。前者用来跟操作系统对齐，
后者用来实现稳定的时间频率。同时引入了三种time warp mode。time correction加上time warp mode，
更好的处理系统时间的跳变。


## 基本概念

* UT1：世界时
* UTC：Coordinated Universal Time，协调世界时，对秒的定义跟UT1有差异，包含闰秒。UTC的一天可能为86399, 86400, 86401秒。
* POSIX Time(aka Unix/Epoch time): Time since EPOCH (UTC 1970-01-01 00:00:00)，POSIX Time的一天刚好为86400秒。奇怪的是EPOCH被定义为UTC时间。
* `OS System Time`：操作系统视角的POSIX time。存在时间跳跃。
* `Erlang System Time`: Erlang运行时视角的POSIX time。跟操作系统时间可能有偏差。
* Erlang monotonic time: events, timers, time interval, 单调，但是不严格单调递增。
* Time offset: 通过时间偏移来同步操作系统时间，无需修改单调时间的频率。

时间单位：每秒多少个单位:
* second，1
* millisecond，1000
* microsecond，1000000
* nanosecond，1000000000
* native，Erlang runtime system使用的单位，不同的操作系统会不一样。我的电脑里面，Windows下为1024000，CentOS下为1000000000。

时间单位之间的转化可以通过函数实现：
`erlang:convert_time_unit(Time, FromUnit, ToUnit)`。

## Time Warp Mode
* `no_time_warp` 默认方式，系统启动的时候就决定了time offset，以后也不会改变。
跟之前的系统兼容。因为offset不会变。所以只能通过调整monotonic_time的频率来接近系统时间。
这会造成monotonic_time的时间频率存在1%的误差。
* `multi_time_warp` 直接改变offset来同步时间，monotonic_time保持相对的稳定，当系统时间发生跳变的时候，
可以通过`erlang:monitor(time_offset, clock_service)`来获得通知。
* `single_time_warp` 主要用于嵌入式系统。
* 可以通过虚拟机标记`+C no_time_mode | multi_time_warp | single_time_warp`来配置。

## Time Correction

- 可以通过虚拟机标记来配置是否开启：`+c true | false`
- 如果设置为true，Erlang通过加速和减速来跟操作系统时间同步。幅度最大是1%，也就是说，VM经历1秒实际上可能是0.99秒或者1.01秒。
当系统时间改变了1分钟，erlang会花100分钟来慢慢校正，并最终与系统时间同步。
- 如果设置为false，当操作系统时间落后时，虚拟机时间会停滞。直到操作系统时间追上来为止。这意味着重复调用erlang:monotonic_time()会返回相同的值。
当操作系统时间领先时，monotonic_time前跳。

可以通过函数`erlang:system_info(time_correction).`来查看时间纠正是否开启。
关闭这个选项不会获得任何好处，而且当发生时间跳变时，Erlang monotonic time可能向前跳或者停止。
所以这个选项一般都是打开的。

一般常用到的配置：
* `+c true +C no_time_warp` offset保持不变，mono改变%1来追赶OS时间。跟18之前表现是一样的。
* `+c true +C multi_time_warp` offset随着OS时间而变化，mono保持相对稳定的频率。

## OS System Time

操作系统时间不是单调递增的。系统时间随时可以修改。比如我取了一个操作系统时间t1，
然后将系统时间改为1天前，再取一个系统时间t2，t2-t1的出来是个负值。

新API主要提供这三个接口来获取操作系统时间。
* `os:system_time()` 返回native时间单位的操作系统时间`os system time`
* `os:system_time(Unit)` 将操作系统时间转化为Unit时间单位。等价于 `erlang:convert_time_unit(os:system_time(), native, Unit)`。
* `os:timestamp() -> {MegaSecs, Secs, MicroSecs}`
    - `calendar:now_to_universal_time/1`
    - `calendar:now_to_local_time/1`

比如计算年月日：

```erlang
format_utc_timestamp() ->
    TS = {_,_,Micro} = os:timestamp(),
    { {Year,Month,Day},{Hour,Minute,Second} } = calendar:now_to_universal_time(TS),
    Mstr = element(Month,{"Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"}),
    io_lib:format("~2w ~s ~4w ~2w:~2..0w:~2..0w.~6..0w",[Day,Mstr,Year,Hour,Minute,Second,Micro]).
```
另外，erlang:date()，erlang:localtime()等函数都是通过操作系统时间算出来的。
通过下面的接口可以看到操作系统接口调用的底层接口，比如Windows下面是这样的：

```erlang
> erlang:system_info(os_system_time_source).
[{function,'GetSystemTime'},
 {resolution,100},
 {parallel,yes},
 {time,1558773547665408}]

> erlang:system_info(os_monotonic_time_source).
[{function,'GetTickCount64'},
 {resolution,100},
 {extended,no},
 {parallel,yes},
 {time,1191373658112}]
```

## Erlang System Time

正是因为操作系统时间如此不可靠，我们需要一个经过纠正的虚拟机时间。
这个纠正的虚拟机时间具有以下特性：
* Never jumps backwards or forwards
* Never differs more than 1% in speed from OS Monotonic time
* Attemps to be as close as possible to OS system time

jumping from 1970 to 2015 will take 4500 years to recover, which means all relative time will happen 1% faster for many years.

新API提供以下接口用于获取虚拟机时间：
* erlang:system_time() 返回native时间单位的虚拟机时间`erlang system time`，虚拟机时间由两部分构成：time_offset和monotonic_time。
erlang:system_time() 等价于 erlang:monotonic_time() + erlang:time_offset()
* erlang:system_time(Unit) 将erlang系统时间转化为Unit时间单位。等价于`erlang:convert_time_unit(erlang:system_time(), native, Unit)`
* erlang:monotonic_time() 虚拟机内部的时间引擎。定时器、receive after定时器、BIF定时器、timer模块定时器都是由这个时间触发。
* erlang:time_offset()
* erlang:timestamp() -> {MegaSecs, Secs, MicroSecs} `Erlang system time`，这个函数的存在只是为了兼容现有的代码的时间格式。
`Erlang system time`可以通过上面的函数erlang:system_time/1更加高效的获取。这个函数等价于：

```erlang
timestamp() ->
    ErlangSystemTime = erlang:system_time(microsecond),
    MegaSecs = ErlangSystemTime div 1000000000000,
    Secs = ErlangSystemTime div 1000000 - MegaSecs*1000000,
    MicroSecs = ErlangSystemTime rem 1000000,
    {MegaSecs, Secs, MicroSecs}.
```

## 使用指南

一个总的原则就是：不要使用`erlang:now/0`。根据不同的目的，选择不同的接口。

### 获取系统时间

使用erlang:system_time/1获取系统时间。如果需要erlang:now/0返回的数据格式，可以用erlang:timestamp/0。

### 测量时间差

使用erlang:monotonic_time/0之差来测量时间，结果是native时间单位，可以用erlang:convert_time_unit/3来转化为其他时间单位。
也可以直接使用erlang:monotonic_time/1之差来测量时间，不过这种方式会损失一定的精度。

### 事件的顺序

erlang:unique_integer([monotonic]). 严格单调递增。

### 唯一名字

* erlang:unique_integer/0
* erlang:unique_integer([positive])

### 随机数种子

* erlang:monotonic_time()
* erlang:time_offset()
* erlang:unique_integer()

## 参考文档

* http://learnyousomeerlang.com/time
* erts-9.2/doc/html/time_correction.html
