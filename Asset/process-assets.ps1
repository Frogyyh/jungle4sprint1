param(
  [string]$OutputDirectory = (Join-Path $PSScriptRoot 'processed')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing

$characterDirectory = Join-Path $OutputDirectory 'characters'
$weaponDirectory = Join-Path $OutputDirectory 'weapons'
New-Item -ItemType Directory -Force -Path $characterDirectory, $weaponDirectory | Out-Null

function Find-AlphaBounds {
  param(
    [System.Drawing.Bitmap]$Bitmap,
    [System.Drawing.Rectangle]$SearchArea
  )

  $minX = $SearchArea.Right
  $minY = $SearchArea.Bottom
  $maxX = $SearchArea.Left - 1
  $maxY = $SearchArea.Top - 1

  for ($y = $SearchArea.Top; $y -lt $SearchArea.Bottom; $y++) {
    for ($x = $SearchArea.Left; $x -lt $SearchArea.Right; $x++) {
      if ($Bitmap.GetPixel($x, $y).A -le 8) { continue }
      if ($x -lt $minX) { $minX = $x }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }

  if ($maxX -lt $minX -or $maxY -lt $minY) {
    return $SearchArea
  }

  $padding = 3
  $left = [Math]::Max($SearchArea.Left, $minX - $padding)
  $top = [Math]::Max($SearchArea.Top, $minY - $padding)
  $right = [Math]::Min($SearchArea.Right, $maxX + $padding + 1)
  $bottom = [Math]::Min($SearchArea.Bottom, $maxY + $padding + 1)
  return [System.Drawing.Rectangle]::FromLTRB($left, $top, $right, $bottom)
}

function Set-CanvasQuality {
  param([System.Drawing.Graphics]$Graphics)
  $Graphics.CompositingMode = [System.Drawing.Drawing2D.CompositingMode]::SourceCopy
  $Graphics.CompositingQuality = [System.Drawing.Drawing2D.CompositingQuality]::HighQuality
  $Graphics.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $Graphics.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
  $Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
}

function Export-CharacterFrame {
  param(
    [string]$SourceName,
    [string]$OutputName
  )

  $sourcePath = Join-Path $PSScriptRoot $SourceName
  $source = [System.Drawing.Bitmap]::new($sourcePath)
  try {
    $frameWidth = [Math]::Floor($source.Width / 4)
    $frameArea = [System.Drawing.Rectangle]::new(0, 0, $frameWidth, $source.Height)
    $bounds = Find-AlphaBounds -Bitmap $source -SearchArea $frameArea
    $target = [System.Drawing.Bitmap]::new(128, 128, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($target)
      try {
        Set-CanvasQuality -Graphics $graphics
        $scale = [Math]::Min(116 / $bounds.Width, 116 / $bounds.Height)
        $width = [Math]::Max(1, [Math]::Round($bounds.Width * $scale))
        $height = [Math]::Max(1, [Math]::Round($bounds.Height * $scale))
        $destination = [System.Drawing.Rectangle]::new(
          [Math]::Floor((128 - $width) / 2),
          [Math]::Floor((128 - $height) / 2),
          $width,
          $height
        )
        $graphics.DrawImage($source, $destination, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }
      $target.Save((Join-Path $characterDirectory $OutputName), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $target.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

function Export-Weapon {
  param(
    [string]$SourceName,
    [string]$OutputName,
    [System.Drawing.Rectangle]$SourceArea = [System.Drawing.Rectangle]::Empty
  )

  $sourcePath = Join-Path $PSScriptRoot $SourceName
  $source = [System.Drawing.Bitmap]::new($sourcePath)
  try {
    if ($SourceArea.IsEmpty) {
      $SourceArea = [System.Drawing.Rectangle]::new(0, 0, $source.Width, $source.Height)
    }
    $bounds = Find-AlphaBounds -Bitmap $source -SearchArea $SourceArea
    $scale = [Math]::Min(248 / $bounds.Width, 112 / $bounds.Height)
    $width = [Math]::Max(1, [Math]::Round($bounds.Width * $scale))
    $height = [Math]::Max(1, [Math]::Round($bounds.Height * $scale))
    $target = [System.Drawing.Bitmap]::new($width + 8, $height + 8, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($target)
      try {
        Set-CanvasQuality -Graphics $graphics
        $destination = [System.Drawing.Rectangle]::new(4, 4, $width, $height)
        $graphics.DrawImage($source, $destination, $bounds, [System.Drawing.GraphicsUnit]::Pixel)
      } finally {
        $graphics.Dispose()
      }
      $target.Save((Join-Path $weaponDirectory $OutputName), [System.Drawing.Imaging.ImageFormat]::Png)
    } finally {
      $target.Dispose()
    }
  } finally {
    $source.Dispose()
  }
}

$characters = [ordered]@{
  'Char_DualPistol.png' = 'gunslinger.png'
  'Char_ShieldMan.png' = 'bulwark.png'
  'Char_Robot.png' = 'sentinel.png'
  'Char_Soldier.png' = 'soldier.png'
  'Char_Frog.png' = 'frog.png'
  'Char_Reaper.png' = 'reaper.png'
  'Char_Hunter.png' = 'hunter.png'
  'Char_Ninja.png' = 'ninja.png'
  'Char_Sniper.png' = 'sniper.png'
  'Char_Bomber.png' = 'demolitionist.png'
}

foreach ($entry in $characters.GetEnumerator()) {
  Export-CharacterFrame -SourceName $entry.Key -OutputName $entry.Value
}

$weapons = @(
  @{ Source = 'Wep_Rifle.png'; Output = 'rifle.png' },
  @{ Source = 'Wep_PistolR.png'; Output = 'pistol-r.png' },
  @{ Source = 'Wep_PistolL.png'; Output = 'pistol-l.png' },
  @{ Source = 'Wep_Shield.png'; Output = 'shield.png' },
  @{ Source = 'Wep_Railgun.png'; Output = 'railgun.png' },
  @{ Source = 'Char_DoubleBarrel.png'; Output = 'double-barrel.png' },
  @{ Source = 'Wep_Katana.png'; Output = 'katana.png' },
  @{ Source = 'Wep_Shuriken.png'; Output = 'shuriken.png' },
  @{ Source = 'Wep_ShellGrenade.png'; Output = 'shell-grenade.png' },
  @{ Source = 'Wep_Scythe.png'; Output = 'scythe.png' },
  @{
    Source = 'Wep_10Wep.png'
    Output = 'sniper-rifle.png'
    Area = [System.Drawing.Rectangle]::new(0, 591, 650, 296)
  }
)

foreach ($weapon in $weapons) {
  $area = if ($weapon.Area) { $weapon.Area } else { [System.Drawing.Rectangle]::Empty }
  Export-Weapon -SourceName $weapon.Source -OutputName $weapon.Output -SourceArea $area
}

Write-Output "Processed $($characters.Count) character textures and $($weapons.Count) weapon textures into $OutputDirectory"
