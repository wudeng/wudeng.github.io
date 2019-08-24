---
title: bresemham直线算法
date: 2017-09-25
---

布雷森汉姆光栅直线算法，用于计算光栅图中两点间的直线经过的点，因为其简单高效，被广泛使用。
在网格图中，怪物从A点移动到B点，如果允许怪物走对角线，那么最简单的移动方式就是从x，y方向上同时向目标点靠近，
直到其中方向距离为0，接下来从另一个方向上向目标点移动，那么表现上就是先走对角然后走直线。BTW，`A*`算法中的启发函数h，
在允许对角线移动的网格图中就可以用这种方法计算，称为octile算法，相比曼哈顿距离更精确，比欧氏距离更简单。
```
h = max(dx, dy) + (sqrt2 - 1) * min(dx, dy)
```
本文简单介绍了该算法的推导过程，并用Erlang实现了该算法。

## 推导过程

给定起始点(X0,Y0), (X1, Y1)，先考虑特殊情况，斜率范围从0到1，X0<X1, Y0<Y1。
那么x每前进1步，y前进距离为m，其中m=dy/dx， 我们用e记录y前进的累积值，x每前进1步，e=e+m。
当e>0.5时，应当使y也前进1步，并将1从e中扣去：e=e-1。

概括起来就是一个判断条件，两种更新策略：
```
// e = 0;
e = e + m;
if (e > 0.5) {
    e = e - 1;
} else {
    e = e;
}
```

## 优化

为了去掉除法和浮点计算，我们令`D = 2*dx*e - dx`, 带入上面的三个公式，上面的判断条件和更新策略变成这样：
```
// D = -Dx;
D = D + 2*dy;
if(D > 0) {
    D = D - 2*dx
} else {
    D = D
}
```
初始e=0, 所以D=-dx，然后每次D增加2dy，当D>0时，减去2dx。

## 实现

实现的时候需要把特殊情况一般化。下面的代码给出了一个一般化的计算过程。首先根据轴的长短选择主轴，
主轴就是每次前进一个单位的轴。然后根据起点和终点的大小决定前进的方向，终点大于起点，则+1，否则-1.

```
plot({X0, Y0}, {X1, Y1}) ->
    Dx = abs(X1 - X0),
    Dy = abs(Y1 - Y0),
    StepX = if X1 > X0 -> 1; true -> -1 end,
    StepY = if Y1 > Y0 -> 1; true -> -1 end,
    if
        Dx > Dy -> plot_x({X0, Y0}, {X1, Y1}, 2*Dx, 2*Dy, StepX, StepY, -Dx, [{X0,Y0}]);
        true -> plot_y({X0, Y0}, {X1, Y1}, 2*Dx, 2*Dy, StepX, StepY, -Dy, [{X0,Y0}])
    end.

plot_x({X1, _}, {X1, _}, _DeltaX, _DeltaY, _, _, _D, Path) ->
    lists:reverse(Path);
plot_x({X0, Y0}, {X1, Y1}, DeltaX, DeltaY, StepX, StepY, D0, Path) ->
    Nx = X0 + StepX,
    D1 = D0 + DeltaY,
    {Ny, Nd} = if
        D1 > 0 -> {Y0 + StepY, D1 - DeltaX};
        true -> {Y0, D1}
    end,
    plot_x({Nx, Ny}, {X1, Y1}, DeltaX, DeltaY, StepX, StepY, Nd, [{Nx, Ny}|Path]).


plot_y({_, Y1}, {_, Y1}, _DeltaX, _DeltaY, _, _, _D, Path) ->
    lists:reverse(Path);
plot_y({X0, Y0}, {X1, Y1}, DeltaX, DeltaY, StepX, StepY, D0, Path) ->
    Ny = Y0 + StepY,
    D1 = D0 + DeltaX,
    {Nx, Nd} = if
        D1 > 0 -> {X0 + StepX, D1 - DeltaY};
        true -> {X0, D1}
    end,
    plot_y({Nx, Ny}, {X1, Y1}, DeltaX, DeltaY, StepX, StepY, Nd, [{Nx, Ny}|Path]).
```

## 参考文档

* https://en.wikipedia.org/wiki/Bresenham%27s_line_algorithm
