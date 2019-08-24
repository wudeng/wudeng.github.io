---
title: 技能伤害区域计算
date: 2017-11-23
---

MMO游戏中经常需要实现各种技能的效果，不同技能拥有不同的伤害区域，
一般情况下，我们需要对周围的目标进行遍历，检查目标是否落在伤害区域内。
一般的伤害预期主要是三种：圆形，扇形，矩形。

## 圆形

圆形伤害区域的计算非常简单，给点圆心C, 半径R, 计算P是否在圆内。
只需要计算P到C的欧式距离|P - C|是否小于R即可。为了节省开方计算，
我们可以直接用平方来比较。

```
is_in_circle(#pb_vector3{x = X, z = Z} = P, #pb_vector3{x = X0, z = Y0}, R) ->
    Dx = X - X0,
    Dz = Z - Z0,
    Dx * Dx + Dz * Dz < R * R.
```

## 扇形

扇形伤害区域的计算相对于圆形要复杂一点，[Milo的文章](http://www.cnblogs.com/miloyip/archive/2013/04/19/3029852.html)对扇形的处理有很好的阐述，可惜部分公式显示不出来了。
圆形相当于扇形的特殊形式。这里我们只考虑锐角扇形，即不超过180度的扇形。
给点圆心C, 半径R, 施法者朝向V, 扇形角度Thelta，P是在扇形内需要满足两个条件：
* P到C的欧式距离不超过R，跟圆形的判断一致。
* P到V的夹角小于Thelta/2

判断P到V的夹角有两种方式，一种是分别计算CP和V的与x轴的夹角，然后看这两个夹角检测这两个夹角的差值范围是否在Thelta/2范围内。
这个夹角可以通过atan2函数求得，这里要特别小心角度的范围。考虑到V是常数，可以预先算出夹角，可是还是免不了要计算一个atan2.
另一种办法是用点积。具体参考Milo的文章。

这里我们采用另外一种方法，这个方法来自[StackOverflow](https://stackoverflow.com/questions/13652518/efficiently-find-points-inside-a-circle-sector), 这个方法需要算出扇形的起始向量，假设为StartVector，EndVector，
然后我们只需要判断CP是否在StartVector的逆时针方向，并且在EndVector的顺时针方向。
这里StartVector和EndVector都可以预先计算出来。而判断方向的方法异常简单:

检测v2是否在v1的顺时针方向：
- 找到v1的逆时针法向量，法向量相当于将v1逆时针旋转90度：(x1, y1) -> (-y1, x1)
- 找到v2在法向量上的投影，利用点积计算：p = v2.x * n1.x + v2.y * n1.y
- 如果投影为正，那么v2在v1的逆时针方向，否则为顺时针方向。

我们的输入不包括扇形的两个向量，所以先要计算出这两个向量，根据欧拉公式：

**一定要注意sectorStart和sectorEnd都是相对于扇形圆心的坐标，而不是绝对坐标！！！！**


```
%% #pb_vector3{x = X0, z = Z0} 为施法者坐标指向施法目标的向量
Sin = math:sin(Thelta/2),
Cos = math:cos(Thelta/2),
SectorStart = #pb_vector3{x = X0 * Cos + Z0 * Sin, y = 0, z = -X0 * Sin + Z0 * Cos},
SectorEnd   = #pb_vector3{x = X0 * Cos - Z0 * Sin, y = 0, z = X0 * Sin + Z0 * Cos},
```

给点起始和结束向量，求解坐标是否在扇形内：

```
%% 判断V2是否在V1的顺时针方向
are_clock_wise(#pb_vector3{x = X1, z = Z1}=V1, #pb_vector3{x = X2, z = Z2}=V2) ->
    -X1 * Z2 + Z1 * X2 > 0.

%% 是否在圆内
is_within_radius(#pb_vector3{x = X1, z = Z1}, RadiusSquared) ->
    X1 * X1 + Z1 * Z1 =< RadiusSquared.

%% 是否在扇形内
is_inside_sector(CheckPos, CastingPos, SectorStart, SectorEnd, RadiusSquared) ->
    RelPoint = lib_map_util:get_raw_vector(CastingPos, CheckPos),
    (not are_clock_wise(SectorStart, RelPoint)) andalso
    are_clock_wise(SectorEnd, RelPoint) andalso
    is_within_radius(RelPoint, RadiusSquared).
```

## 矩形

给点施法者的位置C，施法者前方的终点坐标F，技能决定施法的范围Range，可以得到一个矩形区域。

矩形的计算也有几种方法，比如先进行坐标系的转换，在相对坐标系中判断就很简单了。不过坐标的转换略复杂。

这里采用的是另一种方法，通过求点到线段的距离来判断矩形区域。
- 先判断点是否超出线段的起点和终点
- 若没有，则求出点到直线的距离

根据点积可以判断坐标是否落在线段的中部。点积大于0且小于线段长度的平方说明坐标落在线段的中间区间，没有超出两端的范围。
如果没有超出两端，我们就可以算出点到直线的投影点，然后计算点到投影点的距离，从而得到点到直线的距离。

坐标的投影所占的线段的比例为：R = Dot / LengthSquared, 则投影点为：C + R * (F - C)。

```
is_in_rectangle(#pb_vector3{x = X, z = Z} = P, #pb_vector3{x = X1, z = Z1} = C, #pb_vector3{x = X2, z = Z2} = F, RangeSquared) ->
    Dx = X2 - X1,
    Dz = Z2 - Z1,
    LengthSquared = Dx * Dx + Dz * Dz,
    Dot = Dx * (X - X1) + Dz * (Z - Z1),
    Dot >= 0 andalso Dot < LengthSquared andalso begin
        R = Dot / LengthSquared,
        Xp = X1 + Dx * R,
        Zp = Z1 + Dz * R,
        (X-Xp)*(X-Xp) + (Z-Zp)*(Z-Zp) =< RangeSquared
    end.

```

## 参考文献

* https://stackoverflow.com/questions/849211/shortest-distance-between-a-point-and-a-line-segment
* https://en.wikipedia.org/wiki/Rotation_matrix
* https://www.w3schools.com/graphics/tryit.asp?filename=trycanvas_circle


## 附扇形的检验程序

直接存到html文件在浏览器中执行即可，可以通过修改参数改变输出的图形。

```
<!DOCTYPE html>
<html>
<body>

<canvas id="myCanvas" width="400" height="400"
style="border:1px solid #d3d3d3;">
Your browser does not support the canvas element.
</canvas>

<script>
function isInsideSector(point, center, sectorStart, sectorEnd, radiusSquared) {
    var relPoint = {
        x: point.x - center.x,
        y: point.y - center.y
    };

    return !areClockwise(sectorStart, relPoint) &&
         areClockwise(sectorEnd, relPoint) &&
         isWithinRadius(relPoint, radiusSquared);
}

function areClockwise(v1, v2) {
    return -v1.x*v2.y + v1.y*v2.x > 0;
}

function isWithinRadius(v, radiusSquared) {
    return v.x*v.x + v.y*v.y <= radiusSquared;
}

function isInsideSector2(point,center, sectorStart, sectorEnd, radiusSquared) {
    var relPoint = {
        x: point.x - center.x,
        y: point.y - center.y
    };
    return !areClockwise(sectorStart, relPoint) &&
        areClockwise(sectorEnd, relPoint) &&
        isWithinRadius(relPoint, radiusSquared);
}

var canvasSize = 400;
var canvas = document.getElementById("myCanvas");
var ctx = canvas.getContext("2d");
//ctx.beginPath();
//ctx.arc(200,200,200,-Math.PI,0);
//ctx.stroke();

function drawLine(point) {
	ctx.moveTo(200,200);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
}

var center = { x: 200, y: 200 };
var sectorStart = { x: 400, y: 200 };
var sectorEnd = { x: 200, y: 400 };
drawLine(sectorStart);
drawLine(sectorEnd);


for (var i = 0; i < 800; ++i) {

    // generate a random point
    var point = {
      x: Math.random() * canvasSize,
      y: Math.random() * canvasSize
    };

    var sectorCenter = {x:0,y:200};
    var cx = sectorCenter.x - center.x;
    var cy = sectorCenter.y - center.y;
    var thelta = Math.PI/4;
    var sin = Math.sin(thelta);
    var cos = Math.cos(thelta);
    var sectorStart = {
        x: cx*cos + cy*sin,
        y: -cx*sin + cy*cos
    };
    var sectorEnd = {
        x: cx*cos - cy*sin,
        y: cx*sin + cy*cos
    };

    // test if the point is inside the sector
    var isInside = isInsideSector2(point, center, sectorStart,sectorEnd, 40000);
    //var isInside = isInsideSector(point, center, {x:200,y:0}, {x:0,y:200}, 40000);

    // draw the point
    if (isInside) {
        drawLine(point);
    }

}

</script>

</body>
</html>
```
