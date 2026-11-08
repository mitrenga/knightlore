<?php
$path = ltrim(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH), '/');
if ($path !== '' && file_exists(__DIR__.'/'.$path) && !is_dir(__DIR__.'/'.$path)) { return false; }
if ($path !== '' && substr($path, -4) !== '.php') { $_SERVER['QUERY_STRING'] = $path; $_GET = []; }
require __DIR__.'/index.php';
