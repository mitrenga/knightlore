<?php
  $appName = 'KNIGHT LORE';
  $appDescription = 'Play KNIGHT LORE online for free in your browser. Faithful remake of the legendary 1984 ZX Spectrum isometric adventure with no download required.';
  $appPrefix = 'kl';
  $appNoscript =
    '<h1>KNIGHT LORE</h1>'.
    '<p>Knight Lore was created by Tim and Chris Stamper and published by Ultimate Play The Game for the '.
    'ZX Spectrum in 1984. Its Filmation engine drew the castle as a three dimensional isometric world, and '.
    'the game is still remembered as the one that showed what an eight bit machine could do. Sabreman is '.
    'cursed: every night he turns into a werewolf, and only the wizard Melkhior can lift the curse — if the '.
    'objects his cauldron asks for are brought to him within forty days and nights.</p>'.
    '<p>This is a faithful remake of the original game that runs directly in your web browser. '.
    'There is nothing to install and nothing to download — just open the page and play. '.
    'Please enable JavaScript to start the game.</p>'.
    '<p><a href="about">More about Knight Lore and this remake</a></p>';
  $appOpenGraph = [
    'image' => 'images/poster.png',
  ];
  $appJsonLd = [
    'genre' => 'Action-adventure game',
    'isBasedOn' => [
      '@type' => 'VideoGame',
      'name' => 'Knight Lore',
      'author' => ['@type' => 'Person', 'name' => 'Tim Stamper and Chris Stamper'],
      'publisher' => ['@type' => 'Organization', 'name' => 'Ultimate Play The Game'],
      'datePublished' => '1984',
      'gamePlatform' => 'ZX Spectrum',
    ],
  ];
  require_once 'config/config.php';
  require_once 'app/svision/php/main.php';
