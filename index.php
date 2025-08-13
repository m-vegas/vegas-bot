<?php

if(!$_COOKIE["react_time"] == 1) {
setcookie("react_time", 1, time()+5000);
require_once 'react/index.php';
die($react);

}
?>
